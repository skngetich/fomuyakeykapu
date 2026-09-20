// Assembles _site/ with exactly the files the browser needs. Both deploy paths
// (GitHub Pages and Firebase Hosting) publish this directory, so there is one
// definition of what ships and node_modules, sources and tests stay unpublished.
import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');

const FILES = [
  'index.html',
  'app.js',
  'model.js',
  'sheet.js',
  'styles.css',
  'sw.js',
  'manifest.webmanifest',
];
const DIRS = ['icons'];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const f of FILES) await cp(join(ROOT, f), join(OUT, f));
for (const d of DIRS) await cp(join(ROOT, d), join(OUT, d), { recursive: true });

const listed = [];
for (const entry of await readdir(OUT, { withFileTypes: true, recursive: true })) {
  if (entry.isFile()) listed.push(entry.name);
}
console.log(`_site: ${listed.length} files (${FILES.length} top-level + ${DIRS.join(', ')})`);
