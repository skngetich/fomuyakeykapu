// Renders the game as an HTML replica of the FIBA scoresheet (US Letter portrait).
// The same markup is used for on-screen preview and for print / save-as-PDF.
//
// FIBA running-score marking conventions used here:
//   2-pt field goal  -> diagonal line through the new total, shooter's number beside it
//   3-pt field goal  -> same, with the shooter's number circled
//   free throw       -> the new total is circled, no player number
//   end of a period  -> heavy underline beneath the last total of that period
//   end of the game  -> the final total is boxed

import { TEAMS, derive, teamName, periodScores, foulLabel } from './model.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const line = (value, w) =>
  `<span class="fill" style="min-width:${w}">${esc(value) || '&nbsp;'}</span>`;

function timeoutBoxes(team) {
  // Four period rows (2 boxes / 3 boxes / 3 boxes) plus an extra-period row.
  const rows = [
    { label: 'Period 1', periods: [1], n: 2 },
    { label: 'Period 2', periods: [2], n: 2 },
    { label: 'Period 3', periods: [3], n: 3 },
    { label: 'Period 4', periods: [4], n: 3 },
  ];
  const cell = (filled) => `<span class="tbox">${filled ? '<span class="tmark"></span>' : ''}</span>`;
  let html = '';
  for (const r of rows) {
    const used = team.timeouts.filter((t) => r.periods.includes(t.period)).length;
    html += `<div class="to-row"><span class="to-lab">${r.label}</span>${Array.from(
      { length: r.n },
      (_, i) => cell(i < used),
    ).join('')}</div>`;
  }
  const extra = team.timeouts.filter((t) => t.period > 4).length;
  html += `<div class="to-row"><span class="to-lab">Extra periods</span>${Array.from(
    { length: Math.max(3, extra) },
    (_, i) => cell(i < extra),
  ).join('')}</div>`;
  return html;
}

function teamFoulRow(team) {
  const cells = [1, 2, 3, 4]
    .map((p) => {
      const n = team.teamFouls[p];
      const marks = Array.from({ length: 4 }, (_, i) => `<span class="tfbox">${i < n ? '<span class="tmark"></span>' : ''}</span>`).join('');
      return `<div class="tf-row"><span class="tf-lab">P${p}</span>${marks}${n > 4 ? `<span class="tf-over">+${n - 4}</span>` : ''}</div>`;
    })
    .join('');
  return cells;
}

function playerRows(game, d, key) {
  const t = d.teams[key];
  return game.teams[key].players
    .map((p) => {
      const s = t.players[p.id];
      const blank = !p.no && !p.name && !p.licence;
      const foulCells = Array.from({ length: 5 }, (_, i) => {
        const f = s.fouls[i];
        return `<td class="fcell${f ? ' has' : ''}">${f ? esc(foulLabel(f)) : ''}</td>`;
      }).join('');
      return `<tr class="${blank ? 'blank' : ''}${s.out ? ' out' : ''}">
        <td class="lic">${esc(p.licence)}</td>
        <td class="pname">${esc(p.name)}</td>
        <td class="pno">${esc(p.no)}</td>
        <td class="pin">${p.starter ? '<span class="x">✕</span>' : p.in || s.played ? '<span class="x">✓</span>' : ''}</td>
        ${foulCells}
      </tr>`;
    })
    .join('');
}

function teamBlock(game, d, key) {
  const t = d.teams[key];
  return `<section class="team">
    <div class="team-head">
      <span class="lab">Team ${key}</span>${line(teamName(game, key), '52mm')}
    </div>
    <div class="team-grid">
      <div class="to-block">
        <div class="sub">Time-outs</div>
        ${timeoutBoxes(t)}
      </div>
      <div class="tf-block">
        <div class="sub">Team fouls</div>
        ${teamFoulRow(t)}
      </div>
    </div>
    <table class="players">
      <thead>
        <tr>
          <th class="lic">Licence no.</th><th class="pname">Players</th><th class="pno">No.</th>
          <th class="pin">Player in</th><th colspan="5">Fouls</th>
        </tr>
      </thead>
      <tbody>${playerRows(game, d, key)}</tbody>
    </table>
    <div class="coach-row"><span class="lab">Coach</span>${line(game.teams[key].coach, '38mm')}
      <span class="cfouls">${t.coach.all.filter((f) => f.who === 'coach').map((f) => esc(foulLabel(f))).join(' ') || ''}</span></div>
    <div class="coach-row"><span class="lab">Assistant Coach</span>${line(game.teams[key].assistant, '32mm')}
      <span class="cfouls">${t.asst.fouls.map((f) => esc(foulLabel(f))).join(' ') || ''}</span></div>
  </section>`;
}

function runningColumn(d, from, to) {
  let rows = '';
  for (let n = from; n <= to; n++) {
    const cells = TEAMS.map((k) => {
      const t = d.teams[k];
      const m = t.marks[n];
      const end = t.endAt[n];
      const cls = ['rs', m ? (m.pts === 1 ? 'ft' : 'fg') : '', end === 'q' ? 'eop' : end === 'fin' ? 'fin' : '']
        .filter(Boolean)
        .join(' ');
      const no = m && m.pts !== 1 ? `<i class="${m.pts === 3 ? 'three' : ''}">${esc(m.no)}</i>` : '';
      return `<td class="${cls}"><b>${n}</b>${no}</td>`;
    }).join('');
    rows += `<tr>${cells}</tr>`;
  }
  return `<table class="rscol"><thead><tr><th>A</th><th>B</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function scoresBox(game, d) {
  const ps = { A: periodScores(d.teams.A, d.period, d.ended), B: periodScores(d.teams.B, d.period, d.ended) };
  const val = (v) => (v == null ? '' : v);
  let rows = '';
  for (let p = 1; p <= 4; p++) {
    rows += `<tr><td class="lab">Period ${p}</td><td>A ${line(val(ps.A.periods[p - 1]), '10mm')}</td><td>B ${line(val(ps.B.periods[p - 1]), '10mm')}</td></tr>`;
  }
  rows += `<tr><td class="lab">Extra periods</td><td>A ${line(val(ps.A.extra), '10mm')}</td><td>B ${line(val(ps.B.extra), '10mm')}</td></tr>`;
  const winner = d.winner ? teamName(game, d.winner) : d.ended ? '—' : '';
  return `<div class="scores">
    <table class="periods">${rows}</table>
    <div class="final"><b>Final Score</b>
      <span>Team A ${line(d.ended ? d.teams.A.score : '', '12mm')}</span>
      <span>Team B ${line(d.ended ? d.teams.B.score : '', '12mm')}</span>
    </div>
    <div class="winner">Name of winning team ${line(winner, '48mm')}</div>
  </div>`;
}

export function renderSheet(game) {
  const d = derive(game);
  const i = game.info;
  const o = game.officials;
  return `<div class="sheet">
  <header class="sheet-head">
    <div class="fed">FEDERATION INTERNATIONALE DE BASKETBALL<br>INTERNATIONAL BASKETBALL FEDERATION</div>
    <h1>SCORESHEET</h1>
  </header>
  <div class="meta">
    <div><span class="lab">Team A</span>${line(teamName(game, 'A'), '56mm')}<span class="lab">Team B</span>${line(teamName(game, 'B'), '56mm')}</div>
    <div><span class="lab">Competition</span>${line(i.competition, '28mm')}<span class="lab">Date</span>${line(i.date, '22mm')}<span class="lab">Time</span>${line(i.time, '18mm')}<span class="lab">Referee</span>${line(i.referee, '46mm')}</div>
    <div><span class="lab">Game No.</span>${line(i.gameNo, '18mm')}<span class="lab">Place</span>${line(i.place, '32mm')}<span class="lab">Umpire 1</span>${line(i.umpire1, '32mm')}<span class="lab">Umpire 2</span>${line(i.umpire2, '32mm')}</div>
  </div>
  <div class="body">
    <div class="left">
      ${teamBlock(game, d, 'A')}
      ${teamBlock(game, d, 'B')}
    </div>
    <div class="right">
      <div class="rs-title">RUNNING SCORE</div>
      <div class="rs-grid">
        ${runningColumn(d, 1, 40)}${runningColumn(d, 41, 80)}${runningColumn(d, 81, 120)}${runningColumn(d, 121, 160)}
      </div>
      ${scoresBox(game, d)}
    </div>
  </div>
  <footer class="sheet-foot">
    <div class="sigs">
      <div><span class="lab">Scorekeeper</span>${line(o.scorekeeper, '46mm')}</div>
      <div><span class="lab">Assistant Scorekeeper</span>${line(o.assistantScorekeeper, '38mm')}</div>
      <div><span class="lab">Timekeeper</span>${line(o.timekeeper, '46mm')}</div>
      <div><span class="lab">24&quot; operator</span>${line(o.shotClock, '46mm')}</div>
      <div><span class="lab">Referee</span>${line(i.referee, '46mm')}</div>
      <div><span class="lab">Umpire 1</span>${line(i.umpire1, '46mm')}</div>
      <div><span class="lab">Umpire 2</span>${line(i.umpire2, '46mm')}</div>
      <div class="protest"><span class="lab">Captain's signature in case of protest</span>${line(game.protest, '50mm')}</div>
    </div>
  </footer>
</div>`;
}
