# FIBA Scoresheet

An installable web app (PWA) for keeping a basketball game on the official FIBA scoresheet,
courtside, with no network — and exporting it at the end as a PDF that looks like the real form.

No backend and no runtime dependencies: plain ES modules and `localStorage`, with Tailwind
compiled ahead of time into a single committed stylesheet.

## Run it

```bash
npm install
npm run build:css
npm run serve
```

Then open <http://localhost:5173>. `npm run serve` is just `python -m http.server 5173`;
any static host works (GitHub Pages, Netlify, an nginx directory). It only needs to be
served over `http://localhost` or HTTPS for the service worker — and therefore offline use
and "Install app" — to switch on.

While changing styles, run `npm run watch:css` to rebuild `styles.css` on save. The built
`styles.css` is committed, so deploying needs nothing but the static files; Node is only
required to change the styling.

## CI and deployment

Two workflows in [`.github/workflows`](.github/workflows):

**`ci.yml`** runs on every push to `main` and every pull request:

- `npm test` — the FIBA rules in [`test/model.test.js`](test/model.test.js) (`node --test`, no
  test framework to install), covering scoring, foul-outs, disqualifications, team fouls,
  time-out allowances, period scores and the fact that deleting an entry recomputes the sheet.
- rebuilds the stylesheet and **fails if `styles.css` differs from what `src/input.css`
  produces**, so the committed CSS can never drift behind the source.
- checks every file `sw.js` promises to precache actually exists — a missing one makes the
  service worker install reject, which silently breaks offline use.

**`pages.yml`** publishes to GitHub Pages on push to `main`. It copies just the browser-facing
files into `_site/`, so `node_modules`, sources and tests are not published.

It is live at **<https://skngetich.github.io/fomuyakeykapu/>**, and **the published site is
publicly readable** — worth remembering before merging anything you would not want served.
To stop publishing, delete `pages.yml` and turn Pages off under **Settings → Pages**.

Pages is already enabled on this repository. On a fork or a fresh clone the deploy fails until
it is enabled, either under **Settings → Pages** with **Source: GitHub Actions**, or with:

```bash
gh api -X POST repos/OWNER/REPO/pages -f build_type=workflow
```

The `configure-pages` action has an `enablement: true` option for this, but it does not work
with the default workflow token: creating a Pages site needs admin rights that `GITHUB_TOKEN`
is not granted.

The app uses only relative paths, so it works from a project subpath such as
`https://<user>.github.io/fomuyakeykapu/` — no base-URL configuration needed.

## Theme

The button left of **Games** cycles **System → Light → Dark** and remembers the choice in
`localStorage`. On *System* the app follows the OS setting and switches live if that
changes. The chosen theme is applied by a small inline script in `<head>` before first
paint, so reopening the app does not flash the wrong theme.

Colours are defined once as tokens in [`src/input.css`](src/input.css) — `--app-bg`,
`--app-surface`, `--app-text`, `--app-accent` and so on — redefined under `.dark`, and
exposed to Tailwind through `@theme inline` as `bg-surface`, `text-muted`, `border-line`
and friends. Adding a theme means adding one block of token values.

The printed scoresheet is exempt: it is black ink on white paper in either theme.

## Using it

**Setup** — competition, game number, place, date, officials, both team names and coaches,
and the roster (licence no., name, shirt number). Tick **St** for the five starters.
Add rows if a team dresses more than twelve.

**Live** — pick a team, then tap a player card:

| Tap | Records |
| --- | --- |
| `+1` | a made free throw |
| `+2` / `+3` | a field goal |
| `F` | a foul — choose `P` `T` `U` `D` and the free throws awarded |

Bench buttons cover time-outs and coach / assistant fouls. **End Qn** closes a period,
**End game** closes the game and jumps to the sheet. **Undo last** reverses the most recent
entry, and any line in the entry log can be deleted with `✕`.

The app checks entries against the rules and asks before recording something irregular —
scoring for a player who has fouled out, a fourth time-out in a half, ending a game level
or early. It always lets you record it anyway: the scoresheet has to record what actually
happened, including the officials' mistakes.

**Sheet** — a live preview of the form. **Export PDF** opens the print dialog; choose
*Save as PDF* (or *Microsoft Print to PDF*), paper **Letter**, and set margins to **None**
for a one-page match to the printed form. **Save JSON** writes the raw game file, which
**Games → Import JSON** reads back on any device.

## How the sheet is filled in

The running score follows the standard FIBA marking conventions:

- **2-point field goal** — a diagonal line through the new total, with the shooter's number beside it
- **3-point field goal** — the same, with the shooter's number circled
- **Free throw** — the new total is circled, no player number
- **End of a period** — a heavy line under the last total scored in it
- **End of the game** — the final total is boxed

Team fouls show as filled boxes per period (a fifth and beyond as `+n`), time-outs as filled
boxes per half, and a player who has fouled out or been disqualified has their number struck
through.

## Where the data lives

Everything stays on the device in `localStorage` under `fiba.games.v1`; nothing is uploaded.
Clearing the browser's site data deletes saved games, so export the JSON for anything
you need to keep. Leaving the page mid-game prompts before it unloads.

## Files

| File | |
| --- | --- |
| [`model.js`](model.js) | Game state and all the rules. Every derived figure on the sheet — running score, fouls, time-outs, period scores — is computed from the event list, so undo and delete can never leave the sheet inconsistent. |
| [`sheet.js`](sheet.js) | Renders a game as the scoresheet, for both preview and print. |
| [`app.js`](app.js) | Screens, entry flow, theme control, storage, import/export. |
| [`src/input.css`](src/input.css) | Tailwind entry point: theme tokens, component classes, and the scoresheet's own CSS. Edit this, not `styles.css`. |
| `styles.css` | Build output, committed. Generated by `npm run build:css`. |
| [`test/model.test.js`](test/model.test.js) | The rules, pinned down. Run with `npm test`. |
| [`sw.js`](sw.js) | Service worker — stale-while-revalidate, so it opens offline but still picks up a new version. |

The app UI is Tailwind; the printed sheet is hand-written CSS in millimetres under
`@page Letter`. That split is deliberate — the sheet is a dimensional facsimile that has to
land inside one page (it currently renders at 276mm of the 279mm available), which utility
classes describe badly.

## Limits worth knowing

- Period scores are recorded, but there is no game clock; the minute of a time-out is not asked for.
- Substitutions are not tracked minute by minute — the *Player in* column marks starters (`✕`)
  and anyone who later appears in the game (`✓`).
- More than twelve players on a team will push the form onto a second printed page.
