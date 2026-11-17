import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const output = new URL('./dist/', root);
const assets = [
  'index.html', 'favicon.svg', 'styles.css', 'app.js', 'bluetooth.js', 'core.js',
  'manifest.webmanifest', 'pwa.js', 'sw.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(new URL('icons/', output), { recursive: true });
await Promise.all(assets.map(file => copyFile(new URL(file, root), new URL(file, output))));
await writeFile(new URL('.nojekyll', output), '');
console.log(`Built Watt a Breeze: ${assets.length} static assets in dist/`);
