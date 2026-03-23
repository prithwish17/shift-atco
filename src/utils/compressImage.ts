/**
 * compressImage.ts
 * Compresses an image File to a square centre-crop (300×300) WebP blob
 * before uploading to Supabase — saves storage on the free plan.
 */

const TARGET_SIZE = 300;        // px — square crop
const QUALITY     = 0.80;       // 0–1 (80 % looks great, ~30–60 KB per photo)
const OUTPUT_TYPE = "image/webp";

/**
 * Centre-crop, resize to 300×300, and encode as WebP.
 * @param file  Raw File from `<input type="file">`
 * @returns     Compressed WebP Blob ready to upload
 */
export function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      return reject(new Error("Please select a valid image file."));
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement("canvas");
      canvas.width  = TARGET_SIZE;
      canvas.height = TARGET_SIZE;

      const ctx = canvas.getContext("2d")!;

      // Smart square crop (centre-crop, no stretching)
      const { naturalWidth: sw, naturalHeight: sh } = img;
      const side = Math.min(sw, sh);
      const sx   = (sw - side) / 2;
      const sy   = (sh - side) / 2;

      ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET_SIZE, TARGET_SIZE);

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Canvas compression failed."));
          resolve(blob);
        },
        OUTPUT_TYPE,
        QUALITY,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image."));
    };

    img.src = objectUrl;
  });
}
