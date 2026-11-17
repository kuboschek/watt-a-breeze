import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const output = new URL('./dist/', root);
const assets = ['index.html', 'styles.css', 'app.js', 'bluetooth.js', 'core.js'];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(assets.map(file => copyFile(new URL(file, root), new URL(file, output))));
await writeFile(new URL('.nojekyll', output), '');
console.log(`Built Watt a Breeze: ${assets.length} static assets in dist/`);
