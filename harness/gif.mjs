#!/usr/bin/env node
// Shared GIF encoder for the README demo assets — used by render-demo.mjs
// (terminal capture, rasterised from SVG) and record-console.mjs (real browser
// frames). Both feed it the same thing: RGBA frames of identical size, plus a
// per-frame delay.
//
// `gifenc` is a dev-only dependency, deliberately absent from package.json
// because the repo ships with no runtime dependencies:
//
//   npm i --no-save gifenc
//
// Callers get { ok: false, reason } instead of a crash when it is missing, so
// a contributor without the render deps still gets every other output.
import { writeFileSync } from 'node:fs';

// One palette for the whole animation, built from the frames with the most
// distinct colour: a shared palette is smaller than per-frame quantisation and
// free of the frame-to-frame shimmer it causes.
const PALETTE_SIZE = 128;

export async function encodeGif({ frames, delays, outPath, paletteFrame }) {
  let gifenc;
  try {
    gifenc = await import('gifenc');
  } catch {
    return { ok: false, reason: 'needs `npm i --no-save gifenc`' };
  }
  const { GIFEncoder, quantize, applyPalette } = gifenc.default || gifenc;
  if (!frames.length) return { ok: false, reason: 'no frames captured' };

  const reference = paletteFrame || frames[0];
  const palette = quantize(reference.data, PALETTE_SIZE, { format: 'rgba4444' });
  const encoder = GIFEncoder();
  frames.forEach((frame, index) => {
    encoder.writeFrame(applyPalette(frame.data, palette, 'rgba4444'), frame.width, frame.height, {
      palette: index === 0 ? palette : undefined,
      delay: delays[index],
      repeat: 0,
    });
  });
  encoder.finish();
  const bytes = Buffer.from(encoder.bytes());
  writeFileSync(outPath, bytes);
  return {
    ok: true,
    bytes: bytes.length,
    width: frames[0].width,
    height: frames[0].height,
    seconds: delays.reduce((sum, ms) => sum + ms, 0) / 1000,
  };
}

export const describeGif = (result, path) => (result.ok
  ? `${path} (${(result.bytes / 1e6).toFixed(2)} MB, ${result.width}×${result.height}, ${result.seconds.toFixed(1)}s)`
  : `skipped — ${result.reason}`);
