# Basketball Scoresheet

An installable web app (PWA) for keeping a basketball game on a phone, courtside and with no
network, laid out and marked following FIBA scoresheet conventions. At the end it exports a PDF
that looks like the paper form. It is built for local leagues: each sheet carries the league's
own heading (tournament or federation name), and it is not affiliated with FIBA.

No backend and no runtime dependencies: plain ES modules and `localStorage`, with Tailwind
compiled ahead of time into a single committed stylesheet.

## Layout

| Path | |
| --- | --- |
| `/` | Landing page for league organisers and new scorekeepers: what it does, install steps, the explainer video. |
| `/app/` | The app. Its service worker covers only `/app/`, so the landing page is an ordinary online page. |

## Run it

```bash
npm install
npm run serve
```

Then open <http://localhost:5173> (landing page) or <http://localhost:5173/app/> (the app).
`npm run serve` is just `python -m http.server 5173` over the source tree. Run unbuilt like
this, the app reports version `dev` and **does not register its service worker**, so every
edit shows on a plain reload.

To test offline use, installing and updates, run the built site instead:

```bash
npm run serve:site
```

That builds `_site/` and serves it at <http://localhost:5174>, with the service worker on.

While changing styles, run `npm run watch:css` to rebuild `styles.css` on save. The built
`styles.css` is committed, so the source tree runs with no build step.

## Checks

```bash
npm test        # the FIBA rules and the printed sheet (node --test, nothing extra to install)
npm run lint    # ESLint
npm run build   # stylesheet + _site/; fails if anything the app precaches is missing
```

## The explainer video

```bash
npm run video
```

[`scripts/record-video.mjs`](scripts/record-video.mjs) plays one short game in the real app
and writes `media/how-it-works.mp4` and its poster `media/how-it-works.jpg`. The app runs with
`?demo`, which keeps all data in memory, so recording never touches saved games. The teams
and players are made up. It needs Playwright's Chromium (`npx playwright install chromium`)
and `ffmpeg` on the PATH. Re-record whenever the screens change, so the video always shows the
app as it is.

## Deployment (Cloudflare Pages)

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main` and every
pull request. The **check** job runs the tests and lint, fails if `styles.css` is out of date,
and builds `_site/`. Only if that passes does the **deploy** job publish it:

- **push to `main`** → production
- **pull request** → a preview at its own address, posted as a comment on the pull request,
  so a change can be tried on a phone before it is merged

Without the Cloudflare secrets the deploy job skips with a notice instead of failing.

### One-time setup

1. Create a Cloudflare account, then the Pages project (the name becomes the address,
   `<name>.pages.dev`, so choose it once: see below):

   ```bash
   npx wrangler login
   npx wrangler pages project create basketball-scoresheet --production-branch main
   ```

2. Create an API token under **My Profile → API Tokens** with the permission
   **Account → Cloudflare Pages → Edit**, and store it with your account ID:

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```

3. If the project is not named `basketball-scoresheet`, set its name as a repository
   variable: `gh variable set CLOUDFLARE_PROJECT --body <name>`.

**Do not change the address once other people use the app.** Each phone keeps its saved games
and the installed app per address, so moving would strand every scorekeeper's games and need
everyone to reinstall.

### What ships

[`scripts/build-site.mjs`](scripts/build-site.mjs) assembles `_site/` from the landing page,
[`_headers`](_headers), `media/`, and exactly the files listed in `ASSETS` in
[`app/sw.js`](app/sw.js). That list is the one definition of what the app needs, so the
service worker's precache and what is deployed cannot drift apart. The build also stamps the
release version (`<date>.<commit>`) into `app/sw.js` and `app/version.js`.

[`_headers`](_headers) sets a Content-Security-Policy (scripts from this site only, no inline
scripts), `nosniff` and the referrer policy. Nothing is content-hashed, so pages and code are
served `no-cache` (revalidate, not "do not store"); offline is unaffected because the service
worker answers from its own cache.

Cloudflare Pages always redirects `/app/index.html` to `/app/`. That is why the service worker
precaches `./` and never `index.html`: `cache.addAll` rejects a redirected response, and the
worker would fail to install with no visible error.

### Updates never land mid-game

Each release precaches all of its files before it installs, so a phone never runs a mix of
old and new files. While a game is open (it has entries and has not been closed), the app tells
the service worker, which keeps serving the release that game started on, even if the app is
closed and reopened. Once no game is open, the app shows **A new version is ready → Reload**.

## Theme

The button left of **Games** cycles **System → Light → Dark** and remembers the choice in
`localStorage`, shared by the app and the landing page. On *System* it follows the OS setting
live. [`theme-init.js`](theme-init.js) applies the saved theme before first paint, as a blocking
external script so the Content-Security-Policy can forbid inline scripts.

Colours are defined once as tokens in [`src/input.css`](src/input.css) — `--app-bg`,
`--app-surface`, `--app-text`, `--app-accent` and so on — redefined under `.dark`, and exposed
to Tailwind through `@theme inline` as `bg-surface`, `text-muted`, `border-line` and friends.

The printed scoresheet is exempt: it is black ink on white paper in either theme.

## Using it

The **?** button opens *How to score*, which also opens by itself on first launch.

**Setup** — the sheet heading (printed at the top of the sheet; new games start with the last
heading used), competition, game number, place, date, officials, both teams and coaches, and
the roster (shirt number, name, optional licence number). Tick **St** for the five starters.
**Start scoring** warns about a missing team name, repeated or missing shirt numbers, and
anything other than five starters, but always lets you start.

**Live** — the score stays pinned at the top; tap a team's score to show its players, then tap
a player card:

| Tap | Records |
| --- | --- |
| `+1` | a made free throw |
| `+2` / `+3` | a field goal |
| `F` | a foul — choose `P` `T` `U` `D` and the free throws awarded |

Bench buttons cover time-outs and coach / assistant fouls. The bar along the bottom is always
in reach: **Undo** reverses the last entry (with **Redo** in the message), **Log** lists every
entry, where ✕ deletes one (with **Undo** in the message), and **End Qn** / **End game** close
a period or the game after a confirmation.

The app checks entries against the rules and asks before recording something irregular —
scoring for a player who has fouled out, a fourth time-out in a half, ending a game level or
early. It always lets you record it anyway: the scoresheet has to record what actually
happened, including the officials' mistakes.

**Sheet** — a live preview of the form. **Export PDF** opens the print dialog; choose
*Save as PDF*, paper **Letter**, and set margins to **None** for a one-page match. **Save JSON**
writes the raw game file, which **Games → Import JSON** reads back on any device.

## How the sheet is filled in

The running score follows the standard FIBA marking conventions:

- **2-point field goal** — a diagonal line through the new total, with the shooter's number beside it
- **3-point field goal** — the same, with the shooter's number circled
- **Free throw** — the new total is circled, no player number
- **End of a period** — a heavy line under the last total scored in it
- **End of the game** — the final total is boxed

Team fouls show as filled boxes per period (a fifth and beyond as `+n`), time-outs as filled
boxes, and a player who has fouled out or been disqualified has their number struck through.

## Where the data lives

Everything stays on the device in `localStorage` under `scoresheet.games.v1`; nothing is
uploaded. Clearing the browser's site data deletes saved games, so export the JSON for anything
you need to keep. Leaving the page mid-game prompts before it unloads. Two tabs or windows open
at once each re-read the saved list before writing, so neither deletes the other's games.

Saved and imported games pass through `normalizeGame` in [`app/model.js`](app/model.js), which
keeps only known fields, replaces IDs that are not safe to put in HTML, and drops entries that
cannot be valid.

## Files

| File | |
| --- | --- |
| [`index.html`](index.html), [`landing.js`](landing.js) | The landing page. |
| [`config.js`](config.js) | Feedback form link and video path, shared by the landing page and the app. |
| [`app/model.js`](app/model.js) | Game state and all the rules. Every derived figure on the sheet — running score, fouls, time-outs, period scores — is computed from the event list, so undo and delete can never leave the sheet inconsistent. |
| [`app/sheet.js`](app/sheet.js) | Renders a game as the scoresheet, for both preview and print. |
| [`app/app.js`](app/app.js) | Screens, entry flow, theme, storage, import/export, update prompt. |
| [`app/sw.js`](app/sw.js) | Service worker: one complete cache per release, pinned while a game is open. |
| [`src/input.css`](src/input.css) | Tailwind entry point: theme tokens, component classes, and the scoresheet's own CSS. Edit this, not `styles.css`. |
| `styles.css` | Build output, committed. Generated by `npm run build:css`. |
| [`test/`](test) | The rules and the printed sheet, pinned down. |

The app UI is Tailwind; the printed sheet is hand-written CSS in millimetres under
`@page Letter`. That split is deliberate — the sheet is a dimensional facsimile that has to
land inside one page, which utility classes describe badly.

## Limits worth knowing

- Period scores are recorded, but there is no game clock; the minute of a time-out is not asked for.
- Substitutions are not tracked minute by minute — the *Player in* column marks starters (`✕`)
  and anyone who later appears in the game (`✓`).
- More than twelve players on a team will push the form onto a second printed page.
