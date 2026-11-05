// The app's three fonts (public/style.css), bundled locally from Google Fonts (OFL),
// so renders never wait on the network.
import { continueRender, delayRender, staticFile } from 'remotion';

const faces: [string, string, string][] = [
  ['DM Sans', 'fonts/dm-sans.woff2', '100 1000'],
  ['Space Grotesk', 'fonts/space-grotesk.woff2', '300 700'],
  ['Space Mono', 'fonts/space-mono-400.woff2', '400'],
  ['Space Mono', 'fonts/space-mono-700.woff2', '700'],
];

const handle = delayRender('Loading fonts');
Promise.all(faces.map(async ([family, file, weight]) => {
  const face = new FontFace(family, `url(${staticFile(file)}) format('woff2')`, { weight });
  document.fonts.add(await face.load());
})).then(() => continueRender(handle));
