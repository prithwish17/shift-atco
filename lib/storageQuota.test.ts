/**
 * The storage quota guard: putObject() never reaches R2 when the quota says no,
 * gives bytes back when the write fails, and the fail-open / fail-closed split
 * when the quota check itself is unreachable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", () => {
    class Command {
        constructor(readonly input: unknown) {}
    }
    return {
        S3Client: class {
            send = send;
        },
        PutObjectCommand: class extends Command {},
        DeleteObjectCommand: class extends Command {},
        GetObjectCommand: class extends Command {},
        HeadObjectCommand: class extends Command {},
        ListObjectsV2Command: class extends Command {},
    };
});

vi.mock("./apiAuth.js", () => ({ supabaseEnv: { url: "https://db.test", anonKey: "anon" } }));

const { putObject } = await import("./r2.js");
const { StorageQuotaError } = await import("./storageQuota.js");

const fetchMock = vi.fn();

function rpcCalls() {
    return fetchMock.mock.calls.map(([url, init]) => ({
        name: String(url).split("/rpc/")[1],
        body: JSON.parse(String((init as RequestInit).body)),
    }));
}

beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    vi.stubGlobal("fetch", fetchMock);
    send.mockReset();
    fetchMock.mockReset();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("putObject quota guard", () => {
    it("reserves the bytes, then writes", async () => {
        fetchMock.mockResolvedValueOnce(json({ allowed: true }));
        send.mockResolvedValueOnce({});

        await putObject("leave-documents/a.pdf", Buffer.alloc(1234), "application/pdf", { quotaScope: "leave_document" });

        expect(rpcCalls()).toEqual([{ name: "r2_reserve_upload", body: { p_bytes: 1234, p_scope: "leave_document" } }]);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("refuses without touching R2 when the level is full", async () => {
        fetchMock.mockResolvedValueOnce(json({ allowed: false, reason: "storage" }));

        const err = await putObject("announcements/x/a.pdf", Buffer.alloc(10), "application/pdf", { quotaScope: "announcement" }).catch((e) => e);

        expect(err).toBeInstanceOf(StorageQuotaError);
        expect(err.reason).toBe("storage");
        expect(send).not.toHaveBeenCalled();
    });

    it("gives the bytes back when the R2 write fails", async () => {
        fetchMock.mockResolvedValueOnce(json({ allowed: true })).mockResolvedValueOnce(new Response(null, { status: 204 }));
        send.mockRejectedValueOnce(new Error("R2 down"));

        await expect(
            putObject("profiles/e1/a.webp", Buffer.alloc(500), "image/webp", { quotaScope: "profile_picture" }),
        ).rejects.toThrow("R2 down");

        expect(rpcCalls()).toEqual([
            { name: "r2_reserve_upload", body: { p_bytes: 500, p_scope: "profile_picture" } },
            { name: "r2_release_upload", body: { p_bytes: 500 } },
        ]);
    });

    it("lets leave documents through when the quota check is unreachable", async () => {
        fetchMock.mockRejectedValueOnce(new Error("network"));
        send.mockResolvedValueOnce({});

        await putObject("leave-documents/a.pdf", Buffer.alloc(10), "application/pdf", { quotaScope: "leave_document" });

        expect(send).toHaveBeenCalledTimes(1);
    });

    it("refuses announcement attachments when the quota check is unreachable", async () => {
        fetchMock.mockRejectedValueOnce(new Error("network"));

        const err = await putObject("announcements/x/a.pdf", Buffer.alloc(10), "application/pdf", { quotaScope: "announcement" }).catch((e) => e);

        expect(err).toBeInstanceOf(StorageQuotaError);
        expect(err.reason).toBe("unavailable");
        expect(send).not.toHaveBeenCalled();
    });
});
