import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/appConfig";

export const APP_SPLASH_PLAY_MS = 3000;
export const APP_SPLASH_FADE_MS = 450;

interface AppSplashProps {
  fullscreen?: boolean;
  isExiting?: boolean;
}

export function AppSplash({
  fullscreen = true,
  isExiting = false,
}: AppSplashProps) {
  const shouldDockToHeader = fullscreen && isExiting;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-[#061736] px-6 py-10 text-white transition-all duration-500 ease-out",
        fullscreen ? "fixed inset-0 z-[140] min-h-screen" : "min-h-screen",
        isExiting && "scale-[1.02] opacity-0 blur-sm",
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(90,190,255,0.18),_transparent_30%),radial-gradient(circle_at_82%_18%,_rgba(94,234,212,0.14),_transparent_16%),linear-gradient(180deg,_#08111d_0%,_#0a1a2e_52%,_#040b14_100%)]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:72px_72px]" />
      <div className="absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-400/10 blur-3xl" />
      <div className="absolute left-1/2 top-1/2 h-[20rem] w-[20rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300/10 blur-[120px]" />

      <div className="relative z-10 flex w-full max-w-lg flex-col items-center text-center">
        <div
          className="transition-[transform,opacity] duration-500"
          style={{
            transform: shouldDockToHeader
              ? "translate(calc(-50vw + 5rem), calc(-50vh + 5rem)) scale(0.26)"
              : "translate(0, 0) scale(1)",
            opacity: shouldDockToHeader ? 0.95 : 1,
            transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <div className="relative mb-8 flex h-56 w-56 items-center justify-center sm:h-64 sm:w-64">
            <div className="absolute -inset-10 rounded-[2.75rem] bg-[radial-gradient(circle,_rgba(56,189,248,0.24)_0%,_transparent_60%)] opacity-80 blur-3xl" />
            <div className="absolute inset-0 rounded-[2.25rem] border border-white/10 bg-white/[0.05] shadow-[0_28px_90px_rgba(2,12,27,0.58)] backdrop-blur-2xl" />
            <div className="absolute inset-3 rounded-[1.8rem] border border-white/[0.08]" />
            <div className="absolute inset-7 rounded-full border border-sky-200/20 animate-[spin_16s_linear_infinite]" />
            <div
              className="absolute inset-11 rounded-full border border-emerald-200/15"
              style={{ animation: "spin 12s linear infinite reverse" }}
            />
            <div className="absolute inset-16 rounded-full bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.3),_rgba(14,27,45,0.06)_58%,_transparent_76%)]" />
            <div className="relative flex h-32 w-32 items-center justify-center rounded-[1.65rem] border border-white/10 bg-white/[0.05] shadow-[0_14px_40px_rgba(2,12,27,0.42)] sm:h-36 sm:w-36">
              <img
                src="/logo.png"
                alt={APP_NAME}
                className="h-24 w-24 object-contain drop-shadow-[0_10px_24px_rgba(125,211,252,0.2)] sm:h-28 sm:w-28"
              />
            </div>
          </div>
        </div>

        <div
          className={cn(
            "space-y-4 transition-all duration-300 ease-out",
            shouldDockToHeader && "translate-y-4 opacity-0",
          )}
        >
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.48em] text-sky-100/70 sm:text-xs">
            Operations Suite
          </p>
          <h1 className="text-[2.35rem] font-semibold tracking-[0.18em] text-white sm:text-5xl">{APP_NAME}</h1>
          <p className="mx-auto max-w-md text-sm leading-6 text-slate-300/85 sm:text-base">
            Cleanly bringing roster planning, attendance, and shift operations online.
          </p>
        </div>

        <div
          className={cn(
            "mt-8 w-60 transition-all duration-300 ease-out sm:w-72",
            shouldDockToHeader && "translate-y-3 opacity-0",
          )}
        >
          <div className="relative h-[2px] overflow-hidden rounded-full bg-white/12">
            <span
              className="absolute inset-y-0 left-[-35%] w-1/2 rounded-full bg-gradient-to-r from-transparent via-sky-200 to-transparent shadow-[0_0_18px_rgba(125,211,252,0.55)]"
              style={{ animation: "splash-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite" }}
            />
          </div>
          <div className="mt-4 flex items-center justify-between text-[0.62rem] uppercase tracking-[0.34em] text-sky-100/70 sm:text-[0.68rem]">
            <span>Loading workspace</span>
            <span className="text-emerald-200/75">Syncing</span>
          </div>
        </div>
      </div>
    </div>
  );
}