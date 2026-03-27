import Lottie from "lottie-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/appConfig";
import { atcoraSplashAnimation } from "@/lib/atcoraSplashAnimation";

export const APP_SPLASH_PLAY_MS = 3000;
export const APP_SPLASH_FADE_MS = 450;

interface AppSplashProps {
  fullscreen?: boolean;
  isExiting?: boolean;
  loop?: boolean;
}

export function AppSplash({
  fullscreen = true,
  isExiting = false,
  loop = false,
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
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(47,156,219,0.22),_transparent_40%),radial-gradient(circle_at_80%_25%,_rgba(132,255,183,0.16),_transparent_18%),linear-gradient(180deg,_#07162d_0%,_#061736_45%,_#051224_100%)]" />
      <div className="absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/10 blur-3xl" />
      <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_center,_rgba(255,255,255,0.8)_0.7px,_transparent_0.8px)] [background-size:24px_24px]" />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        <div
          className="transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            transform: shouldDockToHeader
              ? "translate(calc(-50vw + 5rem), calc(-50vh + 5rem)) scale(0.26)"
              : "translate(0, 0) scale(1)",
            opacity: shouldDockToHeader ? 0.95 : 1,
          }}
        >
          <div className="relative mb-6 flex h-72 w-72 items-center justify-center rounded-[2rem] border border-white/10 bg-white/5 shadow-[0_24px_80px_rgba(5,18,36,0.55)] backdrop-blur-xl">
          <div className="absolute inset-6 rounded-[1.5rem] border border-sky-300/10" />
          <div className="absolute inset-8 rounded-full border border-sky-400/20" />
          <div className="absolute inset-[3.25rem] rounded-full border border-sky-300/10" />
          <div className="absolute h-56 w-56 rounded-full border border-t-sky-300/80 border-r-transparent border-b-sky-400/15 border-l-transparent animate-[spin_15s_linear_infinite]" />
          <div className="absolute h-48 w-48 rounded-full border border-t-emerald-300/70 border-r-transparent border-b-transparent border-l-transparent animate-[spin_9s_linear_infinite]" />
          <div className="absolute right-[3.9rem] top-[4.1rem] flex h-4 w-4 items-center justify-center">
            <span className="absolute inline-flex h-4 w-4 rounded-full bg-emerald-300/40 animate-ping" />
            <span className="relative h-3.5 w-3.5 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(134,239,172,0.95)]" />
          </div>
          <Lottie
            animationData={atcoraSplashAnimation}
            autoplay
            loop={loop}
            className="absolute h-60 w-60 opacity-75 drop-shadow-[0_0_28px_rgba(56,189,248,0.3)]"
            rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }}
          />
          <div className="relative flex h-44 w-44 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_20%,_rgba(125,211,252,0.12),_transparent_45%),linear-gradient(180deg,_rgba(3,7,58,0.18),_rgba(3,7,58,0.05))] shadow-[0_0_30px_rgba(56,189,248,0.14)]">
            <img
              src="/logo.png"
              alt={APP_NAME}
              className="h-40 w-40 object-contain drop-shadow-[0_0_18px_rgba(56,189,248,0.25)]"
            />
          </div>
        </div>
        </div>

        <div
          className={cn(
            "space-y-3 transition-all duration-300 ease-out",
            shouldDockToHeader && "translate-y-4 opacity-0",
          )}
        >
          <p className="text-xs font-medium uppercase tracking-[0.5em] text-sky-200/80">Operations Suite</p>
          <h1 className="text-4xl font-semibold tracking-[0.22em] text-white sm:text-5xl">{APP_NAME}</h1>
          <p className="mx-auto max-w-sm text-sm leading-6 text-slate-300 sm:text-base">
            Initializing roster intelligence, duty synchronization, and operational dashboards.
          </p>
        </div>

        <div
          className={cn(
            "mt-8 flex items-center gap-3 text-xs uppercase tracking-[0.35em] text-sky-100/75 transition-all duration-300 ease-out",
            shouldDockToHeader && "translate-y-3 opacity-0",
          )}
        >
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(134,239,172,0.8)]" />
          <span>Loading workspace</span>
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-300 [animation-delay:250ms] shadow-[0_0_16px_rgba(125,211,252,0.8)]" />
        </div>
      </div>
    </div>
  );
}