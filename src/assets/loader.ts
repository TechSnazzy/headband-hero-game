/**
 * Asset helpers. Runtime files live in public/ and are served under the Vite
 * base path (/headband-hero-game/ on GitHub Pages), so always build URLs here.
 */
export const BASE_URL = import.meta.env.BASE_URL;

/** URL for a file in public/, e.g. assetUrl('ui/logo.png'). */
export function assetUrl(path: string): string {
  return `${BASE_URL}${path.replace(/^\//, '')}`;
}

/** Preloads images so menus and HUD portraits appear without a flash. */
export function preloadImages(paths: string[]): Promise<void[]> {
  return Promise.all(
    paths.map(
      (p) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = img.onerror = () => resolve();
          img.src = assetUrl(p);
        }),
    ),
  );
}
