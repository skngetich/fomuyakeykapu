// Renders a game as the scoresheet: one A4 SVG, drawn in millimetres
// (viewBox 0 0 210 297), used for the on-screen preview and turned into the PDF.
// Every stroke and label is an SVG presentation attribute rather than CSS, so
// the PDF converter sees exactly what the preview shows.
//
// Laid out after the FIBA form, with the league's own heading; the app is not
// FIBA's. Marking conventions:
//   2-pt field goal  -> diagonal stroke through the new total, shooter's number beside it
//   3-pt field goal  -> the same, with the shooter's number circled
//   free throw       -> the new total is circled, no player number
//   end of a period  -> heavy rule under the last total of that period
//   end of the game  -> the final total is boxed
//   player in        -> X for every player who played; a starter's X is circled
//   time-out         -> the minute of play in the box, or a cross if none was given
//   team fouls       -> the numbers 1 to 4 struck through as each foul is called

import { TEAMS, derive, teamName, periodScores, foulLabel } from './model.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n = (v) => +v.toFixed(2);

/** Shorten text to roughly fit a width in mm at a font size in mm. */
function fit(value, width, size) {
  const s = String(value ?? '');
  const max = Math.max(1, Math.floor(width / (size * 0.52)));
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function text(x, y, value, { size = 2.6, bold = false, anchor = 'start', fill = '#000', spacing = 0 } = {}) {
  if (value === '' || value == null) return '';
  return `<text x="${n(x)}" y="${n(y)}" font-size="${size}"${bold ? ' font-weight="bold"' : ''}${
    anchor === 'start' ? '' : ` text-anchor="${anchor}"`
  }${fill === '#000' ? '' : ` fill="${fill}"`}${spacing ? ` letter-spacing="${spacing}"` : ''}>${esc(value)}</text>`;
}

const line = (x1, y1, x2, y2, w = 0.2) =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#000" stroke-width="${w}"/>`;
const rect = (x, y, w, h, sw = 0.2) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="#000" stroke-width="${sw}"/>`;
const circle = (cx, cy, r, sw = 0.25) =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="#000" stroke-width="${sw}"/>`;
const cross = (x, y, w, h, pad = 1, sw = 0.3) =>
  line(x + pad, y + pad, x + w - pad, y + h - pad, sw) + line(x + w - pad, y + pad, x + pad, y + h - pad, sw);

/** A label, then the value written on a ruled line. */
function field(x, y, label, labelW, lineW, value, { size = 3, bold = false } = {}) {
  return (
    text(x, y, label, { size: 2.4 }) +
    line(x + labelW, y + 0.8, x + labelW + lineW, y + 0.8, 0.15) +
    text(x + labelW + 1, y, fit(value, lineW - 2, size), { size, bold })
  );
}

/* ------------------------------------------------------------------ teams */

const TIMEOUT_ROWS = [
  { label: '1st half', boxes: 2, match: (p) => p <= 2 },
  { label: '2nd half', boxes: 3, match: (p) => p === 3 || p === 4 },
  { label: 'Extra periods', boxes: 3, match: (p) => p > 4 },
];

function timeouts(t, x, y) {
  let out = text(x, y, 'Time-outs', { size: 2.4, bold: true });
  TIMEOUT_ROWS.forEach((row, i) => {
    const base = y + 4.6 + i * 5.8;
    out += text(x, base, row.label, { size: 2.3 });
    const taken = t.timeouts.filter((to) => row.match(to.period));
    for (let b = 0; b < row.boxes; b++) {
      const bx = x + 20 + b * 8;
      const by = base - 3.8;
      out += rect(bx, by, 7, 5);
      const to = taken[b];
      if (!to) continue;
      out += `<g data-timeout="${i}">${
        to.minute !== '' && to.minute != null
          ? text(bx + 3.5, by + 3.7, to.minute, { size: 3, bold: true, anchor: 'middle' })
          : cross(bx, by, 7, 5)
      }</g>`;
    }
    if (taken.length > row.boxes) out += text(x + 20 + row.boxes * 8, base, `+${taken.length - row.boxes}`, { size: 2.4, bold: true });
  });
  return out;
}

function teamFouls(t, x, y) {
  let out = text(x, y, 'Team fouls', { size: 2.4, bold: true });
  for (let p = 1; p <= 4; p++) {
    const base = y + 4.2 + (p - 1) * 4.4;
    const used = t.teamFouls[p];
    out += text(x, base, `Q${p}`, { size: 2.3 });
    for (let b = 0; b < 4; b++) {
      const bx = x + 7 + b * 6;
      const by = base - 3;
      out += rect(bx, by, 5, 3.8, 0.15) + text(bx + 2.5, by + 2.8, b + 1, { size: 2.2, anchor: 'middle', fill: '#555' });
      if (b < used) out += `<g data-teamfoul="${p}">${line(bx + 0.6, by + 3.3, bx + 4.4, by + 0.5, 0.35)}</g>`;
    }
    if (used > 4) out += text(x + 32, base, `+${used - 4}`, { size: 2.4, bold: true });
  }
  return out;
}

// Players table columns, from x = 8: licence, name, number, player in, five fouls.
const COLS = { lic: 8, name: 26, no: 72, pin: 81, fouls: 90, end: 124 };
const FOUL_W = 6.8;
const TABLE_H = 60; // twelve rows of 5mm; more players get thinner rows, never a second page

function players(game, d, k, top) {
  const t = d.teams[k];
  const list = game.teams[k].players;
  const rows = Math.max(12, list.length);
  const rowH = TABLE_H / rows;
  const size = Math.min(2.8, rowH * 0.56);
  const headH = 5;
  let out = rect(COLS.lic, top, COLS.end - COLS.lic, headH + TABLE_H, 0.3);
  const heads = [
    [COLS.lic, COLS.name, 'Licence no.'],
    [COLS.name, COLS.no, 'Players'],
    [COLS.no, COLS.pin, 'No.'],
    [COLS.pin, COLS.fouls, 'Player in'],
    [COLS.fouls, COLS.end, 'Fouls'],
  ];
  for (const [a, b, label] of heads) out += text((a + b) / 2, top + 3.4, label, { size: 2.2, anchor: 'middle' });
  for (const x of [COLS.name, COLS.no, COLS.pin, COLS.fouls]) out += line(x, top, x, top + headH + TABLE_H, 0.2);
  for (let i = 1; i < 5; i++) out += line(COLS.fouls + i * FOUL_W, top + headH, COLS.fouls + i * FOUL_W, top + headH + TABLE_H, 0.12);
  out += line(COLS.lic, top + headH, COLS.end, top + headH, 0.25);

  for (let r = 0; r < rows; r++) {
    const y = top + headH + r * rowH;
    if (r) out += line(COLS.lic, y, COLS.end, y, 0.1);
    const p = list[r];
    if (!p) continue;
    const s = t.players[p.id];
    const base = y + rowH / 2 + size * 0.36;
    let row = text(COLS.lic + 1, base, fit(p.licence, 16, size), { size }) +
      text(COLS.name + 1, base, fit(p.name, 44, size), { size }) +
      text((COLS.no + COLS.pin) / 2, base, p.no, { size, bold: true, anchor: 'middle' });
    // Fouled out or disqualified: the number is struck through.
    if (s?.out && p.no) row += line(COLS.no + 1.5, y + rowH / 2, COLS.pin - 1.5, y + rowH / 2, 0.35);
    if (s?.played) {
      const cx = (COLS.pin + COLS.fouls) / 2;
      const cy = y + rowH / 2;
      const h = Math.min(1.3, rowH * 0.28);
      row += line(cx - h, cy - h, cx + h, cy + h, 0.3) + line(cx + h, cy - h, cx - h, cy + h, 0.3);
      if (p.starter) row += circle(cx, cy, h * 1.7, 0.2);
    }
    (s?.fouls ?? []).slice(0, 5).forEach((f, i) => {
      row += text(COLS.fouls + i * FOUL_W + FOUL_W / 2, base, foulLabel(f), { size, bold: true, anchor: 'middle' });
    });
    out += `<g data-player="${k}${r}"${s?.out ? ' data-out="1"' : ''}>${row}</g>`;
  }
  return { svg: out, bottom: top + headH + TABLE_H };
}

function benchRow(y, label, labelW, name, fouls) {
  let out = field(COLS.lic, y, label, labelW, COLS.fouls - 4 - COLS.lic - labelW, name, { size: 2.8 });
  for (let i = 0; i < 3; i++) {
    const x = COLS.fouls + i * FOUL_W;
    out += rect(x, y - 3.4, FOUL_W, 4.4, 0.15);
    if (fouls[i]) out += text(x + FOUL_W / 2, y, foulLabel(fouls[i]), { size: 2.6, bold: true, anchor: 'middle' });
  }
  if (fouls.length > 3) out += text(COLS.fouls + 3 * FOUL_W + 1, y, `+${fouls.length - 3}`, { size: 2.4, bold: true });
  return out;
}

function teamBlock(game, d, k, top) {
  const t = d.teams[k];
  let out = line(8, top, 124, top, 0.5);
  out += text(8, top + 4.6, `Team ${k}`, { size: 2.6, bold: true });
  out += text(22, top + 4.6, fit(teamName(game, k), 100, 3.4), { size: 3.4, bold: true });
  out += timeouts(t, 8, top + 10);
  out += teamFouls(t, 72, top + 10);
  const table = players(game, d, k, top + 30);
  out += table.svg;
  const coach = t.coach.all.filter((f) => f.who === 'coach');
  out += benchRow(table.bottom + 5, 'Coach', 11, game.teams[k].coach, coach);
  out += benchRow(table.bottom + 10.4, 'Assistant coach', 21, game.teams[k].assistant, t.asst.fouls);
  return out;
}

/* ------------------------------------------------------------------ running score */

const RS = { x: 128, top: 49, headH: 4, rowH: 4.25, blockW: 18.5 };

function runningScore(d) {
  let out = text(165, 46.6, 'Running score', { size: 2.8, bold: true, anchor: 'middle' });
  const bodyTop = RS.top + RS.headH;
  const bodyH = 40 * RS.rowH;
  for (let b = 0; b < 4; b++) {
    const x0 = RS.x + b * RS.blockW;
    // Sub-columns: A shooter | A total | B total | B shooter.
    const col = { aNo: x0, a: x0 + 4.25, b: x0 + 9.25, bNo: x0 + 14.25 };
    out += rect(x0, RS.top, RS.blockW, RS.headH + bodyH, 0.3);
    out += text(x0 + 4.6, RS.top + 3, 'A', { size: 2.4, bold: true, anchor: 'middle' });
    out += text(x0 + 13.9, RS.top + 3, 'B', { size: 2.4, bold: true, anchor: 'middle' });
    out += line(x0, bodyTop, x0 + RS.blockW, bodyTop, 0.25);
    out += line(col.b, RS.top, col.b, bodyTop + bodyH, 0.35);
    out += line(col.a, bodyTop, col.a, bodyTop + bodyH, 0.1);
    out += line(col.bNo, bodyTop, col.bNo, bodyTop + bodyH, 0.1);
    for (let r = 0; r < 40; r++) {
      const total = b * 40 + r + 1;
      const y = bodyTop + r * RS.rowH;
      if (r) out += line(x0, y, x0 + RS.blockW, y, 0.06);
      for (const k of TEAMS) {
        const cx = (k === 'A' ? col.a : col.b) + 2.5;
        const noX = k === 'A' ? col.aNo + 2.125 : col.bNo + 2.125;
        const mark = d.teams[k].marks[total];
        const end = d.teams[k].endAt[total];
        let cell = text(cx, y + 3.1, total, { size: 2.4, anchor: 'middle' });
        if (mark) {
          const cy = y + RS.rowH / 2;
          if (mark.pts === 1) {
            cell += circle(cx, cy, 1.9, 0.3);
          } else {
            cell += line(cx - 2.1, y + RS.rowH - 0.5, cx + 2.1, y + 0.5, 0.3);
            cell += text(noX, y + 3.1, mark.no, { size: 2.3, bold: true, anchor: 'middle' });
            if (mark.pts === 3) cell += circle(noX, cy, 1.85, 0.25);
          }
        }
        if (end === 'q') {
          const [x1, x2] = k === 'A' ? [col.aNo, col.b] : [col.b, col.bNo + 4.25];
          cell += line(x1, y + RS.rowH, x2, y + RS.rowH, 0.7);
        } else if (end === 'fin') {
          cell += rect(cx - 2.5, y + 0.15, 5, RS.rowH - 0.3, 0.5);
        }
        if (mark || end) {
          out += `<g data-rs="${k}${total}"${mark ? ` data-mark="${mark.pts === 1 ? 'ft' : mark.pts === 3 ? 'three' : 'fg'}"` : ''}${
            end ? ` data-end="${end}"` : ''
          }>${cell}</g>`;
        } else {
          out += cell;
        }
      }
    }
  }
  return out;
}

function scores(game, d, top) {
  const ps = { A: periodScores(d.teams.A, d.period, d.ended), B: periodScores(d.teams.B, d.period, d.ended) };
  const pair = (y, label, a, b, bold = false) =>
    text(RS.x, y, label, { size: 2.5, bold }) +
    text(150, y, 'A', { size: 2.4 }) + line(153, y + 0.8, 172, y + 0.8, 0.15) +
    text(162.5, y, a ?? '', { size: 3, bold: true, anchor: 'middle' }) +
    text(176, y, 'B', { size: 2.4 }) + line(179, y + 0.8, 198, y + 0.8, 0.15) +
    text(188.5, y, b ?? '', { size: 3, bold: true, anchor: 'middle' });
  let out = '';
  for (let p = 1; p <= 4; p++) out += pair(top + (p - 1) * 5, `Period ${p}`, ps.A.periods[p - 1], ps.B.periods[p - 1]);
  out += pair(top + 20, 'Extra periods', ps.A.extra, ps.B.extra);
  out += `<g data-final="1">${pair(top + 26.5, 'Final score', d.ended ? d.teams.A.score : '', d.ended ? d.teams.B.score : '', true)}</g>`;
  const winner = d.winner ? teamName(game, d.winner) : d.ended ? '—' : '';
  out += `<g data-winner="1">${field(RS.x, top + 33, 'Winning team', 22, 52, winner, { size: 3, bold: true })}</g>`;
  return out;
}

/* ------------------------------------------------------------------ signatures */

/** Officials sign the printed sheet: the typed name sits small beside a blank line. */
function signature(x, y, label, name, nameW, lineEnd) {
  return (
    text(x, y, label, { size: 2.4 }) +
    text(x + 28, y, fit(name, nameW, 2.4), { size: 2.4, fill: '#444' }) +
    line(x + 29 + nameW, y + 0.6, lineEnd, y + 0.6, 0.15)
  );
}

function footer(game) {
  const i = game.info;
  const o = game.officials;
  let out = line(8, 266, 202, 266, 0.5);
  const left = [
    ['Scorekeeper', o.scorekeeper],
    ['Assistant scorekeeper', o.assistantScorekeeper],
    ['Timekeeper', o.timekeeper],
    ['24" operator', o.shotClock],
  ];
  const right = [
    ['Referee', i.referee],
    ['Umpire 1', i.umpire1],
    ['Umpire 2', i.umpire2],
  ];
  left.forEach(([label, name], r) => (out += `<g data-sign="${esc(label)}">${signature(8, 272 + r * 6, label, name, 26, 100)}</g>`));
  right.forEach(([label, name], r) => (out += `<g data-sign="${esc(label)}">${signature(106, 272 + r * 6, label, name, 26, 202)}</g>`));
  out += text(106, 290, "Captain's signature in case of protest", { size: 2.4 }) + line(152, 290.6, 202, 290.6, 0.15);
  if (game.protest.trim()) {
    out += `<g data-protest="1">${text(8, 295, fit(`Protest: ${game.protest.trim()}`, 194, 2.4), { size: 2.4, bold: true })}</g>`;
  }
  return out;
}

/* ------------------------------------------------------------------ page */

export function renderSheet(game) {
  const d = derive(game);
  const i = game.info;
  const heading = i.heading.trim();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm" font-family="Figtree, sans-serif" class="sheet" role="img" aria-label="Scoresheet">
<rect width="210" height="297" fill="#fff"/>
${heading ? `<g data-heading="1">${text(105, 12.5, fit(heading, 190, 4.2), { size: 4.2, bold: true, anchor: 'middle' })}</g>` : ''}
${text(105, 20, 'SCORESHEET', { size: 4.6, bold: true, anchor: 'middle' })}
${field(8, 28, 'Team A', 12, 80, teamName(game, 'A'), { bold: true })}${field(110, 28, 'Team B', 12, 80, teamName(game, 'B'), { bold: true })}
${field(8, 34, 'Competition', 19, 47, i.competition)}${field(78, 34, 'Date', 8, 23, i.date)}${field(113, 34, 'Time', 8, 15, i.time)}${field(140, 34, 'Referee', 13, 49, i.referee)}
${field(8, 40, 'Game No.', 15, 19, i.gameNo)}${field(46, 40, 'Place', 10, 40, i.place)}${field(100, 40, 'Umpire 1', 15, 36, i.umpire1)}${field(155, 40, 'Umpire 2', 15, 32, i.umpire2)}
${teamBlock(game, d, 'A', 44)}
${teamBlock(game, d, 'B', 153.5)}
${runningScore(d)}
${scores(game, d, 230)}
${footer(game)}
</svg>`;
}
