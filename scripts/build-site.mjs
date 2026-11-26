// Assembles _site/ with exactly the files the browser needs, and stamps the
// release version into the app.
//
// The app's files are read from the ASSETS list in app/sw.js, so the list the
// service worker precaches and the list that ships are the same list: a file
// missing from the repo fails the build instead of silently breaking offline use.
import { execSync } from 'node:child_process';
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');

/** Landing-page files, plus anything optional that only exists once made. */
const SITE = ['index.html', 'landing.js', '_headers'];
const OPTIONAL_DIRS = ['media'];

const exists = (p) => access(p).then(() => true, () => false);

function version() {
  const date = new Date().toISOString().slice(0, 10);
  let sha = process.env.GITHUB_SHA?.slice(0, 7);
  try {
    sha ||= execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    sha ||= 'local';
  }
  return `${date}.${sha}`;
}

export async function appAssets() {
  const sw = await readFile(join(ROOT, 'app/sw.js'), 'utf8');
  const list = sw.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1];
  if (!list) throw new Error('app/sw.js has no ASSETS list');
  return [...list.matchAll(/'([^']+)'/g)]
    .map((m) => m[1])
    .filter((f) => f !== './')
    .map((f) => posix.normalize(posix.join('app', f)));
}

async function build() {
  const files = ['app/index.html', 'app/sw.js', ...(await appAssets()), ...SITE];
  const missing = [];
  for (const f of files) if (!(await exists(join(ROOT, f)))) missing.push(f);
  if (missing.length) throw new Error(`Missing from the repo: ${missing.join(', ')}`);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  for (const f of files) await cp(join(ROOT, f), join(OUT, f), { recursive: true });
  for (const d of OPTIONAL_DIRS) {
    if (await exists(join(ROOT, d))) await cp(join(ROOT, d), join(OUT, d), { recursive: true });
  }

  // A new VERSION changes sw.js, which is what makes browsers install the release.
  const v = version();
  for (const f of ['app/sw.js', 'app/version.js']) {
    const p = join(OUT, f);
    const src = await readFile(p, 'utf8');
    const out = src.replace(/const VERSION = 'dev';/, `const VERSION = '${v}';`);
    if (out === src) throw new Error(`${f} has no VERSION = 'dev' to stamp`);
    await writeFile(p, out);
  }
  console.log(`_site: ${files.length} files, version ${v}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await build();
