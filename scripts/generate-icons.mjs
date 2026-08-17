// Generates the PWA / favicon icon set from an inline SVG (brand gradient +
// heart), so there are no binary source assets to keep in sync — re-run with
// `node scripts/generate-icons.mjs` to regenerate. Uses sharp (already present
// as a Next dependency) to rasterize.
import sharp from "sharp";
import { writeFileSync } from "fs";

const HEART =
  "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";

// Heart centered at ~50% scale inside a full-bleed gradient — full-bleed means
// the icon is safe as a maskable icon (no important content near the edges).
function svg(size) {
  const s = size * 0.5 / 24;            // scale the 24-viewBox heart to ~50%
  const tx = size / 2 - 12 * s;
  const ty = size / 2 - 12.2 * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a855f7"/>
      <stop offset="1" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <g transform="translate(${tx} ${ty}) scale(${s})">
    <path d="${HEART}" fill="#ffffff"/>
  </g>
</svg>`;
}

const targets = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["public/apple-touch-icon.png", 180],
];

for (const [path, size] of targets) {
  const buf = await sharp(Buffer.from(svg(size))).png().toBuffer();
  writeFileSync(path, buf);
  console.log("wrote", path, size + "px");
}
