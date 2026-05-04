import type { ReactNode } from "react";

import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface MobileZoomFrameProps {
  children: ReactNode;
  mobileScale?: number;
  mobileMode?: "transform" | "zoom";
  className?: string;
}

export function MobileZoomFrame({
  children,
  mobileScale = 0.88,
  mobileMode = "transform",
  className,
}: MobileZoomFrameProps) {
  const isMobile = useIsMobile();

  const zoomStyle = isMobile
    ? mobileMode === "zoom"
      ? {
          zoom: mobileScale,
          width: `${100 / mobileScale}%`,
        }
      : {
          transform: `scale(${mobileScale})`,
          transformOrigin: "top left",
          width: `${100 / mobileScale}%`,
        }
    : undefined;

  return (
    <div className={cn("w-full", isMobile && "overflow-x-auto", className)}>
      <div style={zoomStyle} className={cn(isMobile && mobileMode === "transform" && "pb-12")}>
        {children}
      </div>
    </div>
  );
}