// Renders review stills: node scripts/review.mjs <Wide|Tall> frame frame ...
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path';

const [id, ...frames] = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const composition = await selectComposition({ serveUrl, id });
for (const f of frames) {
  const output = path.resolve(`review2/${id}-${String(f).padStart(4, '0')}.png`);
  await renderStill({ serveUrl, composition, frame: Number(f), output, scale: id === 'Wide' ? 0.5 : 0.4 });
  console.log(output);
}
