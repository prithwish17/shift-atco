/**
 * Serve the `api/` serverless functions from the Vite dev server.
 *
 * In production Vercel runs everything under `api/` as a function. `vite dev`
 * knows nothing about them, so it answers `/api/...` with `index.html` and the
 * caller gets HTML where it expected JSON. That makes any page backed by a
 * function untestable locally without `vercel dev`, which needs the project
 * linked and the environment pulled.
 *
 * This plugin closes that gap: it resolves the request path to a file under
 * `api/`, loads it through Vite's own module pipeline (so TypeScript and HMR
 * work), and calls its default export behind a small Express-shaped adapter —
 * `req.query`, `req.body`, `res.status().json()` — which is the slice of the
 * Vercel runtime these handlers actually use.
 *
 * Dev only: `apply: "serve"` keeps it out of the production build entirely.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin, type ViteDevServer } from "vite";

const API_DIR = "api";

/** Resolve `/api/night-allocation/2026-09-20/generate` to a handler file. */
function resolveHandler(root: string, pathname: string): { file: string; params: Record<string, string | string[]> } | null {
  const segments = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  let dir = join(root, API_DIR);
  const params: Record<string, string | string[]> = {};

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;

    // An exact file wins over any dynamic segment.
    if (isLast) {
      for (const extension of [".ts", ".js"]) {
        const exact = join(dir, segment + extension);
        if (existsSync(exact)) return { file: exact, params };
      }
    }

    const nested = join(dir, segment);
    if (existsSync(nested) && !isLast) {
      dir = nested;
      continue;
    }

    // Fall back to a dynamic file in this directory: [...route].ts first,
    // since a catch-all swallows everything below it.
    const entries = existsSync(dir) ? readdirSync(dir) : [];
    const catchAll = entries.find(entry => /^\[\.\.\..+\]\.(ts|js)$/.test(entry));
    if (catchAll) {
      const name = catchAll.replace(/^\[\.\.\.|\]\.(ts|js)$/g, "");
      params[name] = segments.slice(index);
      return { file: join(dir, catchAll), params };
    }
    const dynamic = entries.find(entry => /^\[[^.].*\]\.(ts|js)$/.test(entry));
    if (dynamic && isLast) {
      const name = dynamic.replace(/^\[|\]\.(ts|js)$/g, "");
      params[name] = segment;
      return { file: join(dir, dynamic), params };
    }

    if (isLast) return null;
    dir = nested;
  }
  return null;
}

/** The slice of the Vercel response API these handlers use. */
interface AdaptedResponse extends ServerResponse {
  status(code: number): AdaptedResponse;
  json(body: unknown): AdaptedResponse;
  send(body: unknown): AdaptedResponse;
}

function adaptResponse(res: ServerResponse): AdaptedResponse {
  const response = res as AdaptedResponse;
  response.status = (code: number) => {
    res.statusCode = code;
    return response;
  };
  response.json = (body: unknown) => {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
    return response;
  };
  response.send = (body: unknown) => {
    if (typeof body === "string" || Buffer.isBuffer(body)) res.end(body);
    else response.json(body);
    return response;
  };
  return response;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

export function apiDevServer(): Plugin {
  return {
    name: "atcora:api-dev-server",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      // The functions read process.env directly, as they do on Vercel. Vite
      // only exposes VITE_-prefixed vars to the client, so load the rest here.
      const env = loadEnv(server.config.mode, server.config.root, "");
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();

        const match = resolveHandler(server.config.root, url.pathname);
        if (!match) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: `No function matches ${url.pathname}` }));
          return;
        }

        try {
          const module = await server.ssrLoadModule(match.file);
          const handler = module.default;
          if (typeof handler !== "function") throw new Error(`${match.file} has no default export`);

          const request = req as IncomingMessage & Record<string, unknown>;
          request.query = { ...Object.fromEntries(url.searchParams), ...match.params };
          request.body = await readBody(req);

          await handler(request, adaptResponse(res));
          if (!res.writableEnded) res.end();
        } catch (error) {
          server.ssrFixStacktrace(error as Error);
          console.error(`[api-dev-server] ${url.pathname} failed`, error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: (error as Error).message }));
        }
      });
    },
  };
}
