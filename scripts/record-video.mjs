// Records the landing page's explainer video from the real app.
//
//   npm run video
//
// Serves the source tree, opens the app in demo mode (?demo: in-memory data,
// never a visitor's saved games) inside a phone frame, plays one short game
// with captions and tap highlights, and writes media/how-it-works.mp4 plus a
// still for the poster. Needs ffmpeg on PATH. Re-run it whenever the screens
// change; the video is meant to show the app as it is.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'media');
const TMP = join(ROOT, '_video');
const W = 720;
const H = 1280;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

// A static server over the source tree: the app runs unbuilt, with no service worker.
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path === '__stage') return res.writeHead(200, { 'content-type': 'text/html' }).end(STAGE);
  // normalize() turns / into \ on Windows, so check for either separator.
  const file = join(ROOT, /[\\/]$/.test(path) || path === '' ? join(path, 'index.html') : path);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/** Made-up teams for a public video: no real league, club or player. */
function demoGame() {
  const names = {
    A: ['Sam Okoro', 'Lee Park', 'Ana Ruiz', 'Tom Hale', 'Ben Cole', 'Max Reid', 'Ivo Lund', 'Raj Patel'],
    B: ['Jo Banks', 'Kai Moss', 'Eli Ford', 'Noa Kerr', 'Dan Vale', 'Ray Ames', 'Uri Cohen', 'Leo Shaw'],
  };
  const nos = { A: [4, 7, 9, 11, 12, 14, 15, 21], B: [5, 6, 8, 10, 13, 17, 20, 23] };
  const team = (k, name, coach) => ({
    name,
    coach,
    assistant: '',
    players: Array.from({ length: 12 }, (_, i) => ({
      id: `${k}${i}`,
      licence: '',
      name: names[k][i] ?? '',
      no: nos[k][i] ? String(nos[k][i]) : '',
      starter: i < 5,
      in: false,
    })),
  });
  return {
    id: 'demo',
    v: 1,
    createdAt: 0,
    updatedAt: 0,
    started: false,
    info: {
      heading: 'City Summer League', competition: 'Men', gameNo: '12', place: 'Riverside Hall',
      date: '2026-07-18', time: '18:30', referee: 'A. Mensah', umpire1: 'B. Novak', umpire2: '',
    },
    officials: { scorekeeper: 'C. Diaz', assistantScorekeeper: '', timekeeper: 'D. Ito', shotClock: '' },
    protest: '',
    teams: { A: team('A', 'Hawks', 'P. Grant'), B: team('B', 'Lions', 'M. Silva') },
    events: [],
  };
}

const STAGE = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 100%; background: #0f1216; overflow: hidden;
    font-family: "Segoe UI", system-ui, sans-serif; color: #e8ecf1; }
  #cap { position: absolute; left: 40px; right: 40px; top: 52px; height: 150px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; font-size: 40px; font-weight: 650; line-height: 1.2; transition: opacity .25s; }
  #cap small { display: block; font-size: 26px; font-weight: 400; color: #9aa5b4; margin-top: 10px; }
  #phone { position: absolute; left: 50%; top: 236px; width: 390px; height: 700px;
    transform: translateX(-50%) scale(1.42); transform-origin: top center;
    border: 7px solid #2b323d; border-radius: 34px; overflow: hidden; background: #fff; }
  #phone iframe { width: 100%; height: 100%; border: 0; display: block; }
  .tap { position: absolute; width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 50%;
    background: rgb(255 122 26 / .45); border: 3px solid #ff7a1a; pointer-events: none;
    animation: tap .6s ease-out forwards; z-index: 5; }
  @keyframes tap { from { transform: scale(.4); opacity: 1 } to { transform: scale(1.3); opacity: 0 } }
  #card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 24px; background: #0f1216; text-align: center; z-index: 10;
    transition: opacity .4s; }
  #card img { width: 160px; height: 160px; }
  #card h1 { margin: 0; font-size: 52px; }
  #card p { margin: 0; font-size: 30px; color: #9aa5b4; max-width: 560px; line-height: 1.35; }
</style></head><body>
  <div id="cap"></div>
  <div id="phone"><iframe id="app"></iframe></div>
  <div id="card"></div>
</body></html>`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  colorScheme: 'light',
  recordVideo: { dir: TMP, size: { width: W, height: H } },
});
const demo = demoGame();
await context.addInitScript((g) => {
  globalThis.__DEMO_GAME__ = g;
}, demo);
const page = await context.newPage();
await page.goto(`${ORIGIN}/__stage`);

const wait = (ms) => page.waitForTimeout(ms);
const card = async (title, text) => {
  await page.evaluate(
    ([t, p, icon]) => {
      const c = document.getElementById('card');
      c.innerHTML = `<img src="${icon}" alt=""><h1>${t}</h1><p>${p}</p>`;
      c.style.opacity = '1';
      c.style.pointerEvents = 'auto';
    },
    [title, text, `${ORIGIN}/icons/icon.svg`],
  );
};
const hideCard = () =>
  page.evaluate(() => {
    const c = document.getElementById('card');
    c.style.opacity = '0';
    c.style.pointerEvents = 'none';
  });
const caption = (text, sub = '') =>
  page.evaluate(([t, s]) => {
    document.getElementById('cap').innerHTML = s ? `${t}<small>${s}</small>` : t;
  }, [text, sub]);

await card('Basketball Scoresheet', 'Keep the scoresheet on your phone. Here is one game, start to finish.');
await page.evaluate((src) => (document.getElementById('app').src = src), `${ORIGIN}/app/?demo`);
const app = page.frameLocator('#app');
await app.locator('#go-live').waitFor();
await wait(2600);
await hideCard();

/** Highlight where a finger would land, then tap. */
async function tap(locator, pause = 700) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    await page.evaluate(([x, y]) => {
      const d = document.createElement('div');
      d.className = 'tap';
      d.style.left = `${x}px`;
      d.style.top = `${y}px`;
      document.body.append(d);
      setTimeout(() => d.remove(), 700);
    }, [box.x + box.width / 2, box.y + box.height / 2]);
  }
  await wait(220);
  await locator.click();
  await wait(pause);
}
/** A player card's button, by shirt number: '+1' '+2' '+3' or 'F'. */
function act(no, label) {
  const p = ['A', 'B'].flatMap((k) => demo.teams[k].players).find((x) => x.no === no);
  return app.locator(label === 'F' ? `[data-foul="${p.id}"]` : `[data-sc="${p.id}.${label.slice(1)}"]`);
}

// 1. Setup
await caption('Set up once before tip-off', 'Sheet heading, teams, shirt numbers, starters');
await wait(2200);
await app.locator('#view').evaluate((v) => v.scrollTo({ top: 380, behavior: 'smooth' }));
await wait(1800);
await app.locator('#view').evaluate((v) => v.scrollTo({ top: 0, behavior: 'smooth' }));
await wait(600);
await tap(app.locator('#go-live'), 900);
if (await app.locator('#dlg-confirm[open]').count()) {
  throw new Error(`The demo roster trips a setup warning: ${await app.locator('#confirm-warnings').innerText()}`);
}

// 2. Scoring
await caption('Tap a player to score', '+2 for a field goal');
await tap(act('4', '+2'), 1100);
await caption('+3 for a three');
await tap(act('7', '+3'), 1100);
await caption('+1 for a made free throw');
await tap(act('9', '+1'), 1100);
await caption('Tap a score to switch teams');
await tap(app.locator('[data-team="B"]'), 900);
await tap(act('5', '+2'), 1000);

// 3. A foul
await caption('F records a foul', 'Pick the type and the free throws');
await tap(act('8', 'F'), 900);
await tap(app.locator('#foul-types button', { hasText: 'P' }), 500);
await tap(app.locator('#foul-ft button', { hasText: '2' }), 700);
await tap(app.locator('#foul-ok'), 900);

// 4. A slip, undone
await caption('Tapped the wrong player?', 'Undo takes it straight back');
await tap(act('10', '+3'), 900);
await tap(app.locator('#btn-undo'), 1700);

// 5. End of a period
await caption('End each period', 'It asks first, and you can undo it');
await tap(app.locator('#btn-end-period'), 900);
await tap(app.locator('#confirm-ok'), 1200);

// 6. Montage to the final buzzer
await caption('…three periods later');
const quick = async (team, plays) => {
  await app.locator(`[data-team="${team}"]`).click();
  for (const [no, label] of plays) {
    await act(no, label).click();
    await wait(120);
  }
};
for (let q = 0; q < 3; q++) {
  await quick('A', [['4', '+2'], ['11', '+3'], ['7', '+2'], ['12', '+2'], ['9', '+1'], ['4', '+2']]);
  await quick('B', [['6', '+2'], ['5', '+3'], ['13', '+2'], ['8', '+2'], ['10', '+2']]);
  if (q < 2) {
    await app.locator('#btn-end-period').click();
    await app.locator('#confirm-ok').click();
  }
  await wait(250);
}
await caption('End game at the final buzzer');
await wait(600);
await tap(app.locator('#btn-end-game'), 1000);
await tap(app.locator('#confirm-ok'), 1200);

// 7. The sheet
await caption('The sheet fills itself in', 'Running score, fouls, time-outs, period scores');
await wait(2600);
await app.locator('#view').evaluate((v) => v.scrollTo({ top: v.scrollHeight, behavior: 'smooth' }));
await wait(2200);
await app.locator('#view').evaluate((v) => v.scrollTo({ top: 0, behavior: 'smooth' }));
await wait(900);
await caption('Export it as a PDF', 'Or save the game file to keep a copy');
await wait(400);
const pdf = app.locator('#btn-pdf');
const box = await pdf.boundingBox();
await page.evaluate(([x, y]) => {
  const d = document.createElement('div');
  d.className = 'tap';
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  document.body.append(d);
}, [box.x + box.width / 2, box.y + box.height / 2]);
await wait(2400);

await card('Works with no signal', 'Your games stay on your phone. Nothing to sign up for.');
await wait(3200);

const video = page.video();
await context.close();
await browser.close();
server.close();

// H.264 MP4 plays everywhere, WhatsApp included. The first moment is the
// loading frame before the title card, so it is trimmed.
const webm = await video.path();
await mkdir(OUT, { recursive: true });
const mp4 = join(OUT, 'how-it-works.mp4');
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-ss', '0.5', '-i', webm,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-preset', 'slow',
  '-r', '30', '-movflags', '+faststart', '-an', mp4,
]);
// Poster: the live screen mid-game.
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-ss', '14', '-i', mp4, '-frames:v', '1', '-q:v', '4',
  join(OUT, 'how-it-works.jpg'),
]);
await rm(TMP, { recursive: true, force: true });
const secs = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString().trim();
console.log(`media/how-it-works.mp4: ${Number(secs).toFixed(1)} s`);
