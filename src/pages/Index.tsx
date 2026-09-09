import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { getHomeRouteForRole } from "@/lib/roleRoutes";
import {
  Moon,
  Sun,
  Users,
  CalendarDays,
  FileText,
  BarChart3,
  Clock,
  ShieldCheck,
  ArrowRight,
  User,
  Activity,
  Layers,
} from "lucide-react";

const Index: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, userRole, loading, roleLoading } = useAuth();
  const navigate = useNavigate();

  const [currentTime, setCurrentTime] = useState<string>("");
  const [learnMoreOpen, setLearnMoreOpen] = useState<boolean>(false);

  // Auto redirect logged-in users to their role-specific dashboard
  useEffect(() => {
    if (!loading && !roleLoading && user && userRole) {
      navigate(getHomeRouteForRole(userRole), { replace: true });
    }
  }, [user, userRole, loading, roleLoading, navigate]);

  // Real-time aviation clock formatter (e.g., "Fri, 5 Sep 2026 19:28")
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      };
      const formatted = new Intl.DateTimeFormat("en-GB", options).format(now);
      setCurrentTime(formatted);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen lg:h-screen lg:max-h-screen w-full flex flex-col justify-between bg-[#F8FAFD] dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 selection:bg-blue-500 selection:text-white relative overflow-x-hidden lg:overflow-hidden font-sans transition-colors duration-300">
      {/* SVG ClipPath Definition for Enlarged Dramatic Diagonal Cockpit Slant */}
      <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
        <defs>
          <clipPath id="heroDiagonalSlant" clipPathUnits="objectBoundingBox">
            <path d="M 0.28 0 L 1.0 0 L 1.0 1.0 L 0.04 1.0 C 0.02 0.74, 0.12 0.36, 0.28 0 Z" />
          </clipPath>
        </defs>
      </svg>

      {/* Ambient background subtle radial glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
        <div className="absolute top-[-10%] right-[-5%] w-[650px] h-[650px] rounded-full bg-blue-400/5 blur-3xl dark:bg-blue-600/10" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-sky-400/5 blur-3xl dark:bg-sky-600/10" />
      </div>

      {/* ================= TOP NAVIGATION BAR ================= */}
      <header className="relative z-30 w-full shrink-0 h-16 lg:h-20 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-[#0B1120]/85 backdrop-blur-md px-3 sm:px-8 lg:px-14 flex items-center justify-between">
        {/* Logo & Brand Identity */}
        <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
          <div className="h-8 w-8 sm:h-11 sm:w-11 rounded-full bg-slate-900 dark:bg-blue-600/20 border border-slate-700/20 dark:border-blue-400/30 flex items-center justify-center shadow-xs overflow-hidden p-1 shrink-0">
            <img
              src="/logo.png"
              alt="ATCORA Logo"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-lg sm:text-2xl font-black tracking-[0.14em] sm:tracking-[0.16em] text-slate-900 dark:text-white leading-none">
              ATCORA
            </span>
            <span className="hidden sm:block text-[8px] sm:text-[9.5px] font-semibold tracking-[0.18em] text-slate-500 dark:text-slate-400 uppercase mt-1 truncate">
              AIR TRAFFIC CONTROL OPERATIONS & RESOURCE ADMINISTRATION
            </span>
          </div>
        </div>

        {/* Status, Live Clock & Sign In */}
        <div className="flex items-center gap-1.5 sm:gap-4 shrink-0">
          {/* Live Operational Status */}
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-full bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10.5px] sm:text-xs font-semibold whitespace-nowrap">
            <span className="relative flex h-1.5 w-1.5 sm:h-2 sm:w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 sm:h-2 sm:w-2 bg-emerald-500"></span>
            </span>
            <span className="hidden sm:inline">Operations Online</span>
            <span className="sm:hidden">Online</span>
          </div>

          {/* Divider */}
          <div className="hidden md:block h-3.5 w-px bg-slate-200 dark:bg-slate-800" />

          {/* Live Time */}
          {currentTime && (
            <div className="hidden lg:flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 font-mono tracking-tight whitespace-nowrap">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span>{currentTime}</span>
            </div>
          )}

          {/* Divider */}
          <div className="hidden sm:block h-3.5 w-px bg-slate-200 dark:bg-slate-800" />

          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="rounded-full h-7 w-7 sm:h-9 sm:w-9 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            title="Toggle theme"
          >
            {theme === "light" ? (
              <Moon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            ) : (
              <Sun className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            )}
          </Button>

          {/* Sign In CTA */}
          <Link to="/login" className="shrink-0">
            <button className="inline-flex items-center gap-1 sm:gap-2 pl-1.5 pr-2.5 sm:pr-4 py-1 sm:py-1.5 rounded-full bg-slate-100 hover:bg-slate-200/90 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700/80 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold transition-all group shadow-xs whitespace-nowrap shrink-0">
              <div className="h-5 w-5 sm:h-7 sm:w-7 rounded-full bg-white dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shadow-xs shrink-0">
                <User className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </div>
              <span className="whitespace-nowrap font-medium">Sign In</span>
              <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            </button>
          </Link>
        </div>
      </header>

      {/* ================= HERO MAIN SECTION ================= */}
      <main className="relative z-10 flex-1 w-full flex flex-col lg:grid lg:grid-cols-12 overflow-hidden items-stretch">
        {/* Left Column: Headlines, Mobile Cinematic Visual, CTAs, 4 Pillars */}
        <div className="lg:col-span-5 xl:col-span-5 flex flex-col justify-center px-4 sm:px-8 lg:pl-12 xl:pl-16 lg:pr-6 py-6 lg:py-0 z-20">
          <div className="max-w-xl flex flex-col justify-center space-y-3.5 sm:space-y-5">
            {/* Top Accent line & Eyebrow */}
            <div className="space-y-1.5 sm:space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-[2.5px] bg-[#2563EB] rounded-full" />
                <p className="text-[10px] sm:text-xs font-bold tracking-[0.28em] text-slate-500 dark:text-slate-400 uppercase">
                  PEOPLE POWER SAFER SKIES
                </p>
              </div>
              <h1 className="text-3xl sm:text-4.5xl lg:text-[2.95rem] xl:text-[3.5rem] font-black tracking-tight text-slate-950 dark:text-white leading-[1.08]">
                Manage People.
                <br />
                <span className="text-[#2563EB]">
                  Enable Operations.
                </span>
              </h1>
            </div>

            {/* Mobile Cinematic Tower Card (visible ONLY on mobile / tablet < lg) */}
            <div className="lg:hidden w-full my-1">
              <div className="relative w-full h-44 sm:h-56 rounded-2xl overflow-hidden border border-slate-200/90 dark:border-slate-800 bg-slate-950 shadow-lg shadow-blue-950/15 group">
                <img
                  src="/atc-tower-hero-premium.jpg"
                  alt="Air Traffic Control Operations"
                  className="w-full h-full object-cover object-[center_35%]"
                />
                {/* Gradients for image depth */}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-slate-950/10" />

                {/* Subtle radar arcs on mobile */}
                <svg
                  className="absolute top-0 right-0 w-48 h-48 opacity-35 pointer-events-none"
                  viewBox="0 0 200 200"
                  fill="none"
                >
                  <circle cx="160" cy="40" r="45" stroke="#38BDF8" strokeWidth="1" strokeDasharray="3 4" />
                  <circle cx="160" cy="40" r="85" stroke="#38BDF8" strokeWidth="1" />
                  <circle cx="160" cy="40" r="125" stroke="#38BDF8" strokeWidth="1" strokeDasharray="4 6" />
                </svg>
              </div>
            </div>

            {/* Subtitle */}
            <p className="text-xs sm:text-sm lg:text-[1.02rem] text-slate-600 dark:text-slate-300 leading-relaxed font-normal">
              ATCORA streamlines workforce management for a safer, more efficient tomorrow.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 pt-0.5 sm:pt-1">
              <Link to="/login" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="w-full sm:w-auto h-11 sm:h-12 px-7 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-white font-semibold text-sm sm:text-base shadow-md shadow-blue-600/25 hover:shadow-blue-600/35 active:scale-[0.99] transition-all flex items-center justify-center gap-2 group border-0"
                >
                  <span>Enter ATCORA</span>
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>

              <Button
                variant="outline"
                size="lg"
                onClick={() => setLearnMoreOpen(true)}
                className="w-full sm:w-auto h-11 sm:h-12 px-6 rounded-xl border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium text-sm sm:text-base shadow-2xs transition-all flex items-center justify-center"
              >
                Learn More
              </Button>
            </div>

            {/* 4 Feature Pillars in clean horizontal strip with vertical separators */}
            <div className="pt-3.5 sm:pt-5 border-t border-slate-200/80 dark:border-slate-800/80">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-0 sm:divide-x sm:divide-slate-200/80 dark:sm:divide-slate-800/80">
                {/* Pillar 1: People */}
                <div className="p-2 sm:p-0 sm:pr-3 flex flex-col rounded-xl sm:rounded-none bg-white/50 sm:bg-transparent border border-slate-200/40 sm:border-0 group">
                  <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-[#2563EB] dark:text-blue-400 mb-1.5 sm:mb-2 group-hover:scale-105 transition-transform">
                    <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </div>
                  <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    People
                  </h2>
                  <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                    Manage your team
                  </p>
                </div>

                {/* Pillar 2: Rosters */}
                <div className="p-2 sm:p-0 sm:px-3 flex flex-col rounded-xl sm:rounded-none bg-white/50 sm:bg-transparent border border-slate-200/40 sm:border-0 group">
                  <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-[#2563EB] dark:text-blue-400 mb-1.5 sm:mb-2 group-hover:scale-105 transition-transform">
                    <CalendarDays className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </div>
                  <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    Rosters
                  </h2>
                  <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                    Plan with confidence
                  </p>
                </div>

                {/* Pillar 3: Leave */}
                <div className="p-2 sm:p-0 sm:px-3 flex flex-col rounded-xl sm:rounded-none bg-white/50 sm:bg-transparent border border-slate-200/40 sm:border-0 group">
                  <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-[#2563EB] dark:text-blue-400 mb-1.5 sm:mb-2 group-hover:scale-105 transition-transform">
                    <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </div>
                  <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    Leave
                  </h2>
                  <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                    Simplify requests
                  </p>
                </div>

                {/* Pillar 4: Insights */}
                <div className="p-2 sm:p-0 sm:pl-3 flex flex-col rounded-xl sm:rounded-none bg-white/50 sm:bg-transparent border border-slate-200/40 sm:border-0 group">
                  <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-[#2563EB] dark:text-blue-400 mb-1.5 sm:mb-2 group-hover:scale-105 transition-transform">
                    <BarChart3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </div>
                  <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    Insights
                  </h2>
                  <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                    Stronger decisions
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Enlarged Diagonal & Slanted Aviation Hero Graphic (Desktop lg+) */}
        <div className="hidden lg:flex lg:col-span-7 xl:col-span-7 relative w-full h-full min-h-0 items-center justify-end overflow-hidden pl-2 pr-0">
          {/* Expanded decorative radar circular arcs over sky */}
          <svg
            className="absolute top-0 right-0 w-[680px] h-[680px] opacity-[0.28] dark:opacity-[0.16] -translate-y-4 translate-x-10 pointer-events-none z-10"
            viewBox="0 0 680 680"
            fill="none"
          >
            <circle cx="380" cy="300" r="160" stroke="#2563EB" strokeWidth="1" strokeDasharray="4 6" />
            <circle cx="380" cy="300" r="260" stroke="#2563EB" strokeWidth="1" />
            <circle cx="380" cy="300" r="370" stroke="#2563EB" strokeWidth="1" strokeDasharray="6 8" />
            <circle cx="380" cy="300" r="480" stroke="#2563EB" strokeWidth="1" strokeDasharray="3 5" />
          </svg>

          {/* Full-Height Architectural Slanted Frame */}
          <div className="relative w-full h-full z-10">
            <div
              className="relative w-full h-full bg-slate-950 shadow-2xl shadow-blue-950/25 overflow-hidden"
              style={{ clipPath: "url(#heroDiagonalSlant)" }}
            >
              {/* Hero Tower Photograph */}
              <img
                src="/atc-tower-hero-premium.jpg"
                alt="Air Traffic Control Operations"
                className="w-full h-full object-cover object-[center_35%]"
              />

              {/* Subtle Gradient & Glass Overlays */}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/45 via-transparent to-slate-950/10 pointer-events-none" />
              <div className="absolute inset-0 bg-gradient-to-r from-slate-950/30 via-transparent to-transparent pointer-events-none" />
            </div>

            {/* Floating Vertical Navigation Labels on Top-Right Sky */}
            <div className="absolute top-7 right-8 lg:top-8 lg:right-12 z-20 flex flex-col items-end text-right space-y-2 pointer-events-none drop-shadow-sm">
              <span className="text-[10px] lg:text-[11px] font-bold tracking-[0.28em] text-slate-700 dark:text-white/90">
                PEOPLE
              </span>
              <span className="text-[10px] lg:text-[11px] font-bold tracking-[0.28em] text-slate-700 dark:text-white/90">
                ROSTERS
              </span>
              <span className="text-[10px] lg:text-[11px] font-bold tracking-[0.28em] text-slate-700 dark:text-white/90">
                DUTIES
              </span>
              <span className="text-[10px] lg:text-[11px] font-bold tracking-[0.28em] text-slate-700 dark:text-white/90">
                READINESS
              </span>
              <span className="text-[10px] lg:text-[11px] font-bold tracking-[0.28em] text-slate-700 dark:text-white/90">
                A SAFER TOMORROW
              </span>
              <div className="w-5 h-[2px] bg-[#2563EB] rounded-full mt-1 shadow-xs" />
            </div>
          </div>
        </div>
      </main>

      {/* ================= BOTTOM METRICS & TRUST BAR ================= */}
      <footer className="relative z-30 w-full shrink-0 min-h-16 lg:h-18 border-t border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-[#0B1120]/90 backdrop-blur-md px-4 sm:px-8 lg:px-14 py-3 lg:py-0 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0">
        {/* Key Metrics */}
        <div className="w-full sm:w-auto grid grid-cols-3 sm:flex items-center justify-between sm:justify-start gap-2 sm:gap-8 lg:gap-10">
          {/* Metric 1 */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-[#2563EB] dark:text-blue-400 shadow-2xs shrink-0">
              <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] sm:text-xs lg:text-sm font-bold text-slate-900 dark:text-white leading-none truncate">
                400+
              </span>
              <span className="text-[9.5px] sm:text-[10px] lg:text-[10.5px] text-slate-500 dark:text-slate-400 font-medium mt-0.5 truncate">
                Personnel
              </span>
            </div>
          </div>

          {/* Metric 2 */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 border-l border-slate-200/60 sm:border-0 pl-2 sm:pl-0">
            <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-[#2563EB] dark:text-blue-400 shadow-2xs shrink-0">
              <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] sm:text-xs lg:text-sm font-bold text-slate-900 dark:text-white leading-none truncate">
                24×7
              </span>
              <span className="text-[9.5px] sm:text-[10px] lg:text-[10.5px] text-slate-500 dark:text-slate-400 font-medium mt-0.5 truncate">
                Operations
              </span>
            </div>
          </div>

          {/* Metric 3 */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 border-l border-slate-200/60 sm:border-0 pl-2 sm:pl-0">
            <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-[#2563EB] dark:text-blue-400 shadow-2xs shrink-0">
              <ShieldCheck className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] sm:text-xs lg:text-sm font-bold text-slate-900 dark:text-white leading-none truncate">
                Safer Skies
              </span>
              <span className="text-[9.5px] sm:text-[10px] lg:text-[10.5px] text-slate-500 dark:text-slate-400 font-medium mt-0.5 truncate">
                Through People
              </span>
            </div>
          </div>
        </div>

        {/* Right Signature / Watermark */}
        <div className="flex items-center gap-2 sm:gap-2.5 text-right shrink-0">
          <div className="w-4 sm:w-5 h-[2px] bg-[#2563EB] rounded-full shrink-0" />
          <div className="flex flex-col text-left sm:text-right">
            <span className="text-[11px] sm:text-xs font-bold tracking-wider text-slate-800 dark:text-slate-200 leading-none">
              ATCORA
            </span>
            <span className="text-[7.5px] sm:text-[8.5px] font-semibold tracking-[0.2em] text-slate-500 dark:text-slate-400 uppercase mt-0.5">
              PEOPLE KEEP THE SKIES MOVING
            </span>
          </div>
        </div>
      </footer>

      {/* ================= LEARN MORE INTERACTIVE DIALOG ================= */}
      <Dialog open={learnMoreOpen} onOpenChange={setLearnMoreOpen}>
        <DialogContent className="max-w-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-7">
          <DialogHeader>
            <DialogTitle className="text-xl sm:text-2xl font-bold text-slate-950 dark:text-white">
              Enterprise Air Traffic Control HR & Roster Management
            </DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-300 text-xs sm:text-sm mt-1">
              ATCORA delivers mission-critical workforce automation designed for high-density aviation environments.
            </DialogDescription>
          </DialogHeader>

          <div className="grid sm:grid-cols-2 gap-3.5 py-3">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
              <div className="flex items-center gap-2 text-[#2563EB] dark:text-blue-400 font-semibold text-sm mb-1">
                <CalendarDays className="h-4 w-4" />
                <span>6-Group Rolling Roster</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Automated night-morning-afternoon shift sequencing with continuous rest rule enforcement and fatigue safeguards.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
              <div className="flex items-center gap-2 text-[#2563EB] dark:text-blue-400 font-semibold text-sm mb-1">
                <Layers className="h-4 w-4" />
                <span>Duty Exchange Approvals</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Multi-step duty swaps with automatic conflict validation, supervisor sign-offs, and audit trails.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
              <div className="flex items-center gap-2 text-[#2563EB] dark:text-blue-400 font-semibold text-sm mb-1">
                <Activity className="h-4 w-4" />
                <span>Breath Analyzer & Safety</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Mandatory pre-duty testing records, medical validations, and rating proficiency trackers.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
              <div className="flex items-center gap-2 text-[#2563EB] dark:text-blue-400 font-semibold text-sm mb-1">
                <FileText className="h-4 w-4" />
                <span>Comp-Off & Leave Ledgers</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Granular leave balance calculation, retroactive credit adjustments, and gazetted holiday management.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2.5 border-t border-slate-200 dark:border-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Ready to access your account?
            </span>
            <Link to="/login" onClick={() => setLearnMoreOpen(false)}>
              <Button className="bg-[#2563EB] hover:bg-blue-700 text-white rounded-xl gap-1.5 text-xs sm:text-sm h-9 px-4">
                <span>Go to Login</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
