# FIBA Scoresheet

A installable web app (PWA) for keeping a basketball game on the official FIBA scoresheet,
courtside, with no network — and exporting it at the end as a PDF that looks like the real form.

No build step, no dependencies, no backend. Plain ES modules and `localStorage`.

## Run it

```bash
python -m http.server 5173
```

Then open <http://localhost:5173>. Any static host works (GitHub Pages, Netlify, an
nginx directory); it only needs to be served over `http://localhost` or HTTPS for the
service worker — and therefore offline use and "Install app" — to switch on.

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
| [`app.js`](app.js) | Screens, entry flow, storage, import/export. |
| [`styles.css`](styles.css) | App UI, then the sheet itself in millimetres under `@page Letter`. |
| [`sw.js`](sw.js) | Service worker — stale-while-revalidate, so it opens offline but still picks up a new version. |

## Limits worth knowing

- Period scores are recorded, but there is no game clock; the minute of a time-out is not asked for.
- Substitutions are not tracked minute by minute — the *Player in* column marks starters (`✕`)
  and anyone who later appears in the game (`✓`).
- More than twelve players on a team will push the form onto a second printed page.
