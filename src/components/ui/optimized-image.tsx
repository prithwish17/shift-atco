import { useState, type ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface OptimizedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
    /**
     * Whether to render a low-key skeleton placeholder while the image loads.
     * Defaults to true.
     */
    showPlaceholder?: boolean;
    /**
     * Skeleton wrapper className overrides (rounded variants, sizes, etc.).
     * The component itself sets aspect-square by default; pass your own here.
     */
    wrapperClassName?: string;
    /** Fallback element shown when the image fails to load. */
    fallback?: React.ReactNode;
}

/**
 * Light wrapper around <img> that:
 *  - lazy-loads (`loading="lazy"`, `decoding="async"`)
 *  - shows a muted placeholder while loading
 *  - surfaces a `fallback` slot on error
 *  - keeps callers free to pass `srcSet` / `sizes` for retina
 *
 * Use for any image served from the R2 CDN (and elsewhere); the immutable
 * cache headers on R2 + the `loading="lazy"` here give us essentially
 * free image perf.
 */
export function OptimizedImage({
    src,
    alt,
    className,
    wrapperClassName,
    showPlaceholder = true,
    fallback,
    onLoad,
    onError,
    ...rest
}: OptimizedImageProps) {
    const [loaded, setLoaded] = useState(false);
    const [errored, setErrored] = useState(false);

    return (
        <span
            className={cn(
                "relative inline-flex overflow-hidden bg-muted",
                wrapperClassName,
            )}
        >
            {!errored && (
                <img
                    {...rest}
                    src={src}
                    alt={alt}
                    loading={rest.loading ?? "lazy"}
                    decoding={rest.decoding ?? "async"}
                    onLoad={(e) => {
                        setLoaded(true);
                        onLoad?.(e);
                    }}
                    onError={(e) => {
                        setErrored(true);
                        onError?.(e);
                    }}
                    className={cn(
                        "h-full w-full object-cover transition-opacity duration-200",
                        loaded ? "opacity-100" : "opacity-0",
                        className,
                    )}
                />
            )}

            {showPlaceholder && !loaded && !errored && (
                <span
                    aria-hidden
                    className="absolute inset-0 animate-pulse bg-muted-foreground/10"
                />
            )}

            {errored && (fallback ?? <span aria-hidden className="absolute inset-0 bg-muted" />)}
        </span>
    );
}

export default OptimizedImage;
