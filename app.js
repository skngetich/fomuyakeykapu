import {
  TEAMS, PLAYER_FOULS, COACH_FOULS, DEFAULT_FT, newGame, newPlayer, uid,
  derive, teamName, periodLabel, periodName, timeoutGroup, timeoutsUsed,
  warningsFor, describeEvents, isGame,
} from './model.js';
import { renderSheet } from './sheet.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Utility runs repeated across the templates below. Written out in full so
// Tailwind's scanner still sees complete class names.
const GRID2 = 'grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2';
const ROW = 'flex flex-wrap items-center gap-2';
const HINT = 'mt-1.5 text-xs text-muted';
const CTL = 'grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2';

/* ------------------------------------------------------------------ theme */

const THEME_KEY = 'fiba.theme.v1';
const THEMES = ['system', 'light', 'dark'];
const ICON = {
  system: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M1.5 12h2.5M20 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>',
};
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };

const darkMedia = matchMedia('(prefers-color-scheme: dark)');
let theme = 'system';
try {
  const saved = localStorage.getItem(THEME_KEY);
  if (THEMES.includes(saved)) theme = saved;
} catch {
  /* blocked storage — stay on system */
}

function applyTheme() {
  const dark = theme === 'dark' || (theme === 'system' && darkMedia.matches);
  document.documentElement.classList.toggle('dark', dark);
  const btn = $('#btn-theme');
  btn.innerHTML = ICON[theme];
  btn.setAttribute('aria-label', `Theme: ${THEME_LABEL[theme]}. Change theme`);
  btn.title = `Theme: ${THEME_LABEL[theme]}`;
}

function cycleTheme() {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* not persisted, but still applied for this session */
  }
  applyTheme();
  toast(
    `Theme: ${THEME_LABEL[theme]}${theme === 'system' ? ` (${darkMedia.matches ? 'dark' : 'light'})` : ''}`,
  );
}

// Follow the OS only while the user has not pinned a theme.
darkMedia.addEventListener('change', () => {
  if (theme === 'system') applyTheme();
});

/* ------------------------------------------------------------------ store */

const KEY = 'fiba.games.v1';
const LAST = 'fiba.last.v1';

const loadAll = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(isGame) : [];
  } catch {
    return [];
  }
};

function saveAll(games) {
  try {
    localStorage.setItem(KEY, JSON.stringify(games));
  } catch (e) {
    toast('Could not save — device storage is full.');
  }
}

let games = loadAll();
let game = null;
let tab = 'setup';
let liveTeam = 'A';

function persist() {
  game.updatedAt = Date.now();
  const i = games.findIndex((g) => g.id === game.id);
  if (i >= 0) games[i] = game;
  else games.unshift(game);
  saveAll(games);
  localStorage.setItem(LAST, game.id);
}

function openGame(g) {
  game = g;
  tab = g.events.length ? 'live' : 'setup';
  persist();
  render();
}

/* ------------------------------------------------------------------ events */

function pushEvent(ev, { force = false } = {}) {
  const d = derive(game);
  const full = { id: uid(), at: Date.now(), period: d.period, ...ev };
  const warnings = force ? [] : warningsFor(game, d, full);
  if (warnings.length) {
    confirmDialog(warnings, () => commit(full));
    return;
  }
  commit(full);
}

function commit(ev) {
  game.events.push(ev);
  if (!game.started) game.started = true;
  persist();
  render();
}

function undoLast() {
  if (!game.events.length) return;
  const [{ text }] = describeEvents(game).slice(-1);
  game.events.pop();
  persist();
  render();
  toast(`Undone: ${text}`);
}

function removeEvent(id) {
  game.events = game.events.filter((e) => e.id !== id);
  persist();
  render();
}

/* ------------------------------------------------------------------ dialogs */

function confirmDialog(warnings, onOk) {
  const dlg = $('#dlg-confirm');
  $('#confirm-warnings').innerHTML =
    `<ul class="m-0 list-disc pl-4">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
  $('#confirm-body').textContent =
    'The scoresheet is the official record — only record this if it is what actually happened.';
  const ok = $('#confirm-ok');
  const cancel = $('#confirm-cancel');
  const close = () => {
    dlg.close();
    ok.onclick = cancel.onclick = null;
  };
  ok.onclick = () => {
    close();
    onOk();
  };
  cancel.onclick = close;
  dlg.showModal();
}

function foulDialog({ title, types, onOk }) {
  const dlg = $('#dlg-foul');
  $('#foul-title').textContent = title;
  let type = types[0];
  let ft = DEFAULT_FT[type] ?? 0;

  const paintTypes = () => {
    $('#foul-types').innerHTML = types
      .map((t) => `<button class="choice-btn" data-t="${t}" aria-pressed="${t === type}">${t}</button>`)
      .join('');
    $$('#foul-types button').forEach((b) => {
      b.onclick = () => {
        type = b.dataset.t;
        ft = DEFAULT_FT[type] ?? 0;
        paintTypes();
        paintFt();
      };
    });
  };
  const paintFt = () => {
    $('#foul-ft').innerHTML = [0, 1, 2, 3]
      .map((n) => `<button class="choice-btn" data-n="${n}" aria-pressed="${n === ft}">${n}</button>`)
      .join('');
    $$('#foul-ft button').forEach((b) => {
      b.onclick = () => {
        ft = Number(b.dataset.n);
        paintFt();
      };
    });
  };
  paintTypes();
  paintFt();

  const ok = $('#foul-ok');
  const cancel = $('#foul-cancel');
  const close = () => {
    dlg.close();
    ok.onclick = cancel.onclick = null;
  };
  ok.onclick = () => {
    close();
    onOk({ type, ft });
  };
  cancel.onclick = close;
  dlg.showModal();
}

let toastTimer;
function toast(msg) {
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

/* ------------------------------------------------------------------ setup view */

function setupView() {
  const i = game.info;
  const o = game.officials;
  const f = (label, path, type = 'text') => {
    const [grp, key] = path.split('.');
    const val = grp === 'info' ? i[key] : o[key];
    return `<label class="field">${label}
      <input type="${type}" data-bind="${path}" value="${esc(val)}"></label>`;
  };

  const roster = (k) => `
    <div class="card">
      <h2 class="card-title">Team ${k}</h2>
      <div class="${GRID2}">
        <label class="field">Team name<input type="text" data-bind="teams.${k}.name" value="${esc(game.teams[k].name)}"></label>
        <label class="field">Coach<input type="text" data-bind="teams.${k}.coach" value="${esc(game.teams[k].coach)}"></label>
        <label class="field">Assistant coach<input type="text" data-bind="teams.${k}.assistant" value="${esc(game.teams[k].assistant)}"></label>
      </div>
      <table class="roster w-full border-collapse">
        <thead><tr class="text-left text-[11px] font-normal text-muted">
          <th class="w-[90px] p-1 font-normal">Licence</th>
          <th class="p-1 font-normal">Player</th>
          <th class="w-[62px] p-1 font-normal">No.</th>
          <th class="w-10 p-1 text-center font-normal" title="Starting five">St</th>
          <th class="p-1"></th>
        </tr></thead>
        <tbody>
          ${game.teams[k].players
            .map(
              (p, idx) => `<tr data-pid="${p.id}">
            <td class="px-0.5 py-[3px]"><input type="text" data-player="${k}.${idx}.licence" value="${esc(p.licence)}" inputmode="numeric"></td>
            <td class="px-0.5 py-[3px]"><input type="text" data-player="${k}.${idx}.name" value="${esc(p.name)}" placeholder="Name"></td>
            <td class="px-0.5 py-[3px]"><input type="text" data-player="${k}.${idx}.no" value="${esc(p.no)}" inputmode="numeric" placeholder="#"></td>
            <td class="px-0.5 py-[3px] text-center"><input type="checkbox" data-player="${k}.${idx}.starter" ${p.starter ? 'checked' : ''} aria-label="Starter"></td>
            <td class="px-0.5 py-[3px]"><button class="btn btn-sm btn-ghost" data-delrow="${k}.${idx}" aria-label="Clear row">✕</button></td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <div class="${ROW} mt-2">
        <button class="btn btn-sm" data-addrow="${k}">Add player row</button>
        <span class="${HINT}">Tick <b>St</b> for the five starters.</span>
      </div>
    </div>`;

  return `
    <div class="card">
      <h2 class="card-title">Game</h2>
      <div class="${GRID2}">
        ${f('Competition', 'info.competition')}
        ${f('Game No.', 'info.gameNo')}
        ${f('Place', 'info.place')}
        ${f('Date', 'info.date', 'date')}
        ${f('Time', 'info.time', 'time')}
      </div>
    </div>
    ${roster('A')}
    ${roster('B')}
    <div class="card">
      <h2 class="card-title">Officials</h2>
      <div class="${GRID2}">
        ${f('Referee', 'info.referee')}
        ${f('Umpire 1', 'info.umpire1')}
        ${f('Umpire 2', 'info.umpire2')}
        ${f('Scorekeeper', 'officials.scorekeeper')}
        ${f('Assistant scorekeeper', 'officials.assistantScorekeeper')}
        ${f('Timekeeper', 'officials.timekeeper')}
        ${f('24" operator', 'officials.shotClock')}
      </div>
    </div>
    <div class="${ROW}">
      <button class="btn btn-primary" id="go-live">Start scoring →</button>
    </div>`;
}

function bindSetup(root) {
  $$('[data-bind]', root).forEach((el) => {
    el.oninput = () => {
      const p = el.dataset.bind.split('.');
      if (p[0] === 'teams') game.teams[p[1]][p[2]] = el.value;
      else game[p[0]][p[1]] = el.value;
      persist();
      paintHeader();
    };
  });
  $$('[data-player]', root).forEach((el) => {
    el.oninput = () => {
      const [k, idx, field] = el.dataset.player.split('.');
      const p = game.teams[k].players[Number(idx)];
      p[field] = el.type === 'checkbox' ? el.checked : el.value;
      persist();
    };
  });
  $$('[data-delrow]', root).forEach((el) => {
    el.onclick = () => {
      const [k, idx] = el.dataset.delrow.split('.');
      const p = game.teams[k].players[Number(idx)];
      const d = derive(game);
      const used = d.teams[k].players[p.id];
      if (used && (used.points || used.fouls.length)) {
        toast('That player already has entries on the sheet.');
        return;
      }
      Object.assign(p, newPlayer(), { id: p.id });
      persist();
      render();
    };
  });
  $$('[data-addrow]', root).forEach((el) => {
    el.onclick = () => {
      game.teams[el.dataset.addrow].players.push(newPlayer());
      persist();
      render();
    };
  });
  $('#go-live', root).onclick = () => {
    tab = 'live';
    render();
  };
}

/* ------------------------------------------------------------------ live view */

function liveView() {
  const d = derive(game);
  const k = liveTeam;
  const t = d.teams[k];
  const g = timeoutGroup(d.period);
  const toUsed = timeoutsUsed(t, d.period);
  const tf = t.teamFouls[Math.min(d.period, 4)];

  const roster = game.teams[k].players.filter((p) => p.no || p.name);
  const cards = roster.length
    ? roster
        .map((p) => {
          const s = t.players[p.id];
          return `<div class="pcard${s.out ? ' pcard-out' : ''}">
        <div class="flex items-baseline gap-1.5">
          <span class="min-w-[28px] text-lg font-bold">${esc(p.no || '–')}</span>
          <span class="flex-1 truncate text-xs text-muted">${esc(p.name)}</span>
        </div>
        <div class="mt-0.5 flex gap-2 text-[11px] text-muted">
          <span>Pts <b class="text-text">${s.points}</b></span>
          <span>Fouls <b class="text-text">${s.fouls.length}</b>${s.out ? ' ⛔' : ''}</span>
        </div>
        <div class="mt-1.5 grid grid-cols-4 gap-1">
          <button class="pcard-act" data-sc="${p.id}.1" title="Free throw made">+1</button>
          <button class="pcard-act" data-sc="${p.id}.2">+2</button>
          <button class="pcard-act" data-sc="${p.id}.3">+3</button>
          <button class="pcard-act text-accent" data-foul="${p.id}" title="Player foul">F</button>
        </div>
      </div>`;
        })
        .join('')
    : `<p class="${HINT}">No players entered yet — add them on the <b>Setup</b> tab.</p>`;

  const logItems = describeEvents(game)
    .slice()
    .reverse()
    .map(
      ({ ev, text }) =>
        `<li class="log-row"><span class="flex-1">${esc(text)}</span><button class="btn btn-sm btn-ghost" data-del="${ev.id}" aria-label="Delete entry">✕</button></li>`,
    )
    .join('');

  return `
    <div class="card">
      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
        <div>
          <div class="text-[13px] break-words text-muted">${esc(teamName(game, 'A'))}</div>
          <div class="text-[44px] leading-none font-bold tabular-nums">${d.teams.A.score}</div>
        </div>
        <div class="text-xs text-muted">
          <div class="text-lg font-semibold text-text">${d.ended ? 'FINAL' : periodLabel(d.period)}</div>
          <div>${d.ended ? 'game closed' : periodName(d.period)}</div>
        </div>
        <div>
          <div class="text-[13px] break-words text-muted">${esc(teamName(game, 'B'))}</div>
          <div class="text-[44px] leading-none font-bold tabular-nums">${d.teams.B.score}</div>
        </div>
      </div>
    </div>

    <div class="mb-2.5 flex gap-1.5">
      ${TEAMS.map(
        (x) =>
          `<button class="seg seg-info" data-team="${x}" aria-selected="${x === liveTeam}">${esc(teamName(game, x))}</button>`,
      ).join('')}
    </div>

    <div class="card">
      <div class="${ROW} mb-2.5">
        <span class="pill${tf >= 4 ? ' pill-warn' : ''}">Team fouls ${periodLabel(Math.min(d.period, 4))}: <b>${tf}</b>${tf >= 4 ? ' — bonus' : ''}</span>
        <span class="pill${toUsed >= g.allowed ? ' pill-warn' : ''}">Time-outs ${g.label}: <b>${toUsed}/${g.allowed}</b></span>
        ${t.coach.out ? '<span class="pill pill-warn">Coach disqualified</span>' : ''}
      </div>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">${cards}</div>
    </div>

    <div class="card">
      <h2 class="card-title">${esc(teamName(game, k))} — bench</h2>
      <div class="${CTL}">
        <button class="btn" id="btn-timeout">Time-out</button>
        <button class="btn" id="btn-coach-foul">Coach foul</button>
        <button class="btn" id="btn-asst-foul">Bench / assistant foul</button>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">Game control</h2>
      <div class="${CTL}">
        <button class="btn" id="btn-undo"${game.events.length ? '' : ' disabled'}>Undo last</button>
        <button class="btn" id="btn-end-period"${d.ended ? ' disabled' : ''}>End ${periodLabel(d.period)}</button>
        <button class="btn btn-primary" id="btn-end-game"${d.ended ? ' disabled' : ''}>End game</button>
      </div>
      ${d.ended ? `<p class="${HINT}">Game closed. Open the <b>Sheet</b> tab to export the PDF.</p>` : ''}
    </div>

    <div class="card">
      <h2 class="card-title">Entries (${game.events.length})</h2>
      <ul class="m-0 max-h-[320px] list-none overflow-y-auto p-0">${logItems || '<li class="log-row text-muted">Nothing recorded yet.</li>'}</ul>
    </div>`;
}

function bindLive(root) {
  $$('[data-team]', root).forEach((b) => {
    b.onclick = () => {
      liveTeam = b.dataset.team;
      render();
    };
  });
  $$('[data-sc]', root).forEach((b) => {
    b.onclick = () => {
      const [player, pts] = b.dataset.sc.split('.');
      pushEvent({ t: 'score', team: liveTeam, player, pts: Number(pts) });
    };
  });
  $$('[data-foul]', root).forEach((b) => {
    b.onclick = () => {
      const player = b.dataset.foul;
      const p = game.teams[liveTeam].players.find((x) => x.id === player);
      foulDialog({
        title: `Foul — ${teamName(game, liveTeam)} #${p.no || '?'}`,
        types: PLAYER_FOULS,
        onOk: ({ type, ft }) => pushEvent({ t: 'foul', who: 'player', team: liveTeam, player, type, ft }),
      });
    };
  });
  $$('[data-del]', root).forEach((b) => {
    b.onclick = () => removeEvent(b.dataset.del);
  });

  $('#btn-timeout', root).onclick = () => pushEvent({ t: 'timeout', team: liveTeam });
  $('#btn-coach-foul', root).onclick = () =>
    foulDialog({
      title: `Coach foul — ${teamName(game, liveTeam)}`,
      types: COACH_FOULS,
      onOk: ({ type, ft }) => pushEvent({ t: 'foul', who: 'coach', team: liveTeam, type, ft }),
    });
  $('#btn-asst-foul', root).onclick = () =>
    foulDialog({
      title: `Bench foul — ${teamName(game, liveTeam)}`,
      types: ['B', 'D'],
      onOk: ({ type, ft }) => pushEvent({ t: 'foul', who: 'asst', team: liveTeam, type, ft }),
    });

  $('#btn-undo', root).onclick = undoLast;
  $('#btn-end-period', root).onclick = () => {
    const d = derive(game);
    commit({ id: uid(), at: Date.now(), t: 'endPeriod', team: 'A', period: d.period });
    toast(`${periodName(d.period)} closed.`);
  };
  $('#btn-end-game', root).onclick = () => {
    const d = derive(game);
    const warn = [];
    if (d.teams.A.score === d.teams.B.score) warn.push('The score is level — a basketball game cannot end in a tie.');
    if (d.period < 4) warn.push(`Only ${d.period - 1} of 4 periods have been closed.`);
    const finish = () => {
      // Only close the period if "End <period>" was not already pressed, so the
      // game does not get credited with an extra empty period.
      const last = game.events[game.events.length - 1];
      if (last?.t !== 'endPeriod') {
        commit({ id: uid(), at: Date.now(), t: 'endPeriod', team: 'A', period: d.period });
      }
      commit({ id: uid(), at: Date.now(), t: 'endGame', team: 'A', period: derive(game).period });
      tab = 'sheet';
      render();
    };
    if (warn.length) confirmDialog(warn, finish);
    else finish();
  };
}

/* ------------------------------------------------------------------ sheet view */

function sheetView() {
  const d = derive(game);
  return `
    <div class="card">
      <h2 class="card-title">Export</h2>
      <div class="${ROW}">
        <button class="btn btn-primary" id="btn-pdf">Export PDF</button>
        <button class="btn" id="btn-json">Save JSON</button>
      </div>
      <p class="${HINT}">
        <b>Export PDF</b> opens your print dialog — choose <i>Save as PDF</i> (or <i>Microsoft Print to PDF</i>),
        paper <b>Letter</b>, and turn margins off for an exact match.
        ${d.ended ? '' : '<br>The game is not closed yet, so the final score and winner are left blank.'}
      </p>
    </div>
    <div class="card">
      <h2 class="card-title">Preview</h2>
      <div class="preview-wrap"><div class="origin-top-left" id="preview"></div></div>
    </div>`;
}

function bindSheet(root) {
  const host = $('#preview', root);
  host.innerHTML = renderSheet(game);
  const fit = () => {
    const wrap = host.parentElement;
    const sheet = host.firstElementChild;
    if (!wrap || !sheet) return;
    const scale = Math.min(1, (wrap.clientWidth - 20) / sheet.offsetWidth);
    host.style.transform = `scale(${scale})`;
    wrap.style.height = `${sheet.offsetHeight * scale + 20}px`;
  };
  fit();
  // Stops firing once this view is replaced by another render.
  const onResize = () => (host.isConnected ? fit() : window.removeEventListener('resize', onResize));
  window.addEventListener('resize', onResize);

  $('#btn-pdf', root).onclick = exportPdf;
  $('#btn-json', root).onclick = exportJson;
}

function exportPdf() {
  const root = $('#print-root');
  root.innerHTML = renderSheet(game);
  document.title = `Scoresheet ${teamName(game, 'A')} v ${teamName(game, 'B')}`;
  const cleanup = () => {
    root.innerHTML = '';
    document.title = 'FIBA Scoresheet';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 60);
}

function exportJson() {
  const blob = new Blob([JSON.stringify(game, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `scoresheet-${(game.info.gameNo || game.id).toString().replace(/\W+/g, '')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------------------------------------------ games dialog */

function gamesDialog() {
  const dlg = $('#dlg-games');
  const list = $('#games-list');
  const paint = () => {
    list.innerHTML = `
      <div class="${ROW} mb-2.5">
        <button class="btn btn-primary btn-sm" id="new-game">New game</button>
      </div>
      <ul class="m-0 max-h-[320px] list-none overflow-y-auto p-0">
        ${games
          .map((g) => {
            const d = derive(g);
            return `<li class="log-row">
              <span class="flex-1"><b>${esc(teamName(g, 'A'))} ${d.teams.A.score}–${d.teams.B.score} ${esc(teamName(g, 'B'))}</b>
              <br><span class="text-muted">${esc(g.info.date || '')} ${esc(g.info.competition || '')} · ${d.ended ? 'final' : periodLabel(d.period)}</span></span>
              <button class="btn btn-sm" data-open="${g.id}">Open</button>
              <button class="btn btn-sm btn-danger" data-drop="${g.id}">✕</button>
            </li>`;
          })
          .join('') || '<li class="log-row text-muted">No saved games.</li>'}
      </ul>`;
    $('#new-game', list).onclick = () => {
      dlg.close();
      openGame(newGame());
    };
    $$('[data-open]', list).forEach((b) => {
      b.onclick = () => {
        dlg.close();
        openGame(games.find((g) => g.id === b.dataset.open));
      };
    });
    $$('[data-drop]', list).forEach((b) => {
      b.onclick = () => {
        const g = games.find((x) => x.id === b.dataset.drop);
        confirmDialog(
          [`Delete ${teamName(g, 'A')} v ${teamName(g, 'B')}? This cannot be undone.`],
          () => {
            games = games.filter((x) => x.id !== b.dataset.drop);
            saveAll(games);
            if (game.id === b.dataset.drop) openGame(games[0] || newGame());
            paint();
            dlg.showModal();
          },
        );
        dlg.close();
      };
    });
  };
  paint();
  $('#games-close').onclick = () => dlg.close();
  $('#games-import').onclick = () => $('#file-import').click();
  dlg.showModal();
}

$('#file-import').onchange = async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!isGame(data)) throw new Error('shape');
    data.id = uid();
    $('#dlg-games').close();
    openGame(data);
    toast('Game imported.');
  } catch {
    toast('That file is not a saved scoresheet.');
  }
};

/* ------------------------------------------------------------------ shell */

function paintHeader() {
  const d = derive(game);
  $('#subtitle').textContent = game.started
    ? `${teamName(game, 'A')} ${d.teams.A.score}–${d.teams.B.score} ${teamName(game, 'B')} · ${d.ended ? 'final' : periodLabel(d.period)}`
    : 'New game';
}

function render() {
  const view = $('#view');
  view.innerHTML = tab === 'setup' ? setupView() : tab === 'live' ? liveView() : sheetView();
  if (tab === 'setup') bindSetup(view);
  else if (tab === 'live') bindLive(view);
  else bindSheet(view);
  $$('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.id === `tab-${tab}`)));
  paintHeader();
}

$$('[role="tab"]').forEach((b) => {
  b.onclick = () => {
    tab = b.id.replace('tab-', '');
    render();
  };
});
$('#btn-games').onclick = gamesDialog;
$('#btn-theme').onclick = cycleTheme;

// Keep an in-progress game from being lost to an accidental navigation.
window.addEventListener('beforeunload', (e) => {
  if (game?.started && !derive(game).ended) {
    e.preventDefault();
    e.returnValue = '';
  }
});

applyTheme();

const lastId = localStorage.getItem(LAST);
game = games.find((g) => g.id === lastId) || games[0] || newGame();
tab = game.events.length ? 'live' : 'setup';
persist();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
