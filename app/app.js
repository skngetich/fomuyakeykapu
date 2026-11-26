import {
  PLAYER_FOULS, COACH_FOULS, DEFAULT_FT, newGame, newPlayer, uid,
  derive, teamName, periodLabel, periodName, timeoutGroup, timeoutsUsed,
  warningsFor, setupWarnings, isOpen, describeEvents, normalizeGame,
} from './model.js';
import { renderSheet } from './sheet.js';
import { VERSION } from './version.js';
import { VIDEO, feedbackUrl } from '../config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Utility runs repeated across the templates below. Written out in full so
// Tailwind's scanner still sees complete class names.
const GRID2 = 'grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3';
const ROW = 'flex flex-wrap items-center gap-2';
const HINT = 'mt-2 text-xs text-muted';
const CTL = 'grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2';

/* ------------------------------------------------------------------ storage */

// ?demo runs the app on throwaway in-memory data. It exists to record the
// explainer video, and must never read or overwrite a visitor's saved games.
const DEMO = new URLSearchParams(location.search).has('demo');
const memory = new Map();

const store = {
  get(k) {
    if (DEMO) return memory.get(k) ?? null;
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    if (DEMO) {
      memory.set(k, v);
      return true;
    }
    try {
      localStorage.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
};

/* ------------------------------------------------------------------ theme */

const THEME_KEY = 'scoresheet.theme.v1';
const THEMES = ['system', 'light', 'dark'];
const ICON = {
  system: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M1.5 12h2.5M20 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>',
};
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
const X_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

const darkMedia = matchMedia('(prefers-color-scheme: dark)');
let theme = 'system';
try {
  // Read straight from localStorage, like theme-init.js, so demo mode keeps the look.
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

/* ------------------------------------------------------------------ games */

const KEY = 'scoresheet.games.v1';
const LAST = 'scoresheet.last.v1';
const HEADING = 'scoresheet.heading.v1';
const HELP_SEEN = 'scoresheet.help.v1';

const readStored = () => {
  try {
    const v = JSON.parse(store.get(KEY) || '[]');
    return Array.isArray(v) ? v.map(normalizeGame).filter(Boolean) : [];
  } catch {
    return [];
  }
};

function writeStored(list) {
  if (!store.set(KEY, JSON.stringify(list))) toast('Could not save — device storage is full');
}

let games = readStored();
let game = null;
let tab = 'setup';
let liveTeam = 'A';

/** A new game, headed like the last one so a league's scorer types it once. */
function freshGame() {
  const g = newGame();
  g.info.heading = store.get(HEADING) ?? '';
  return g;
}

function persist() {
  game.updatedAt = Date.now();
  // Re-read before writing: another tab or window may have saved other games
  // since this one loaded, and writing a stale list would delete its work.
  games = readStored();
  const i = games.findIndex((g) => g.id === game.id);
  if (i >= 0) games[i] = game;
  else games.unshift(game);
  writeStored(games);
  store.set(LAST, game.id);
  reportGameOpen();
}

function dropGame(id) {
  games = readStored().filter((g) => g.id !== id);
  writeStored(games);
}

// Another tab saved: pick up its list, and its copy of this game if newer.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !game) return;
  games = readStored();
  const fresh = games.find((g) => g.id === game.id);
  if (fresh && fresh.updatedAt > game.updatedAt) {
    game = fresh;
    render();
    toast('Updated from another window');
  }
});

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

/** Run fn only if the same game is still open, so a late Undo can't edit another game. */
const onGame = (fn) => {
  const id = game.id;
  return () => {
    if (game.id === id) fn();
  };
};

function undoLast() {
  if (!game.events.length) return;
  const [{ text }] = describeEvents(game).slice(-1);
  const ev = game.events.pop();
  persist();
  render();
  toast(`Undone: ${text}`, {
    label: 'Redo',
    run: onGame(() => commit(ev)),
  });
}

function removeEvent(id) {
  const i = game.events.findIndex((e) => e.id === id);
  if (i < 0) return;
  const { text } = describeEvents(game)[i];
  const [ev] = game.events.splice(i, 1);
  persist();
  render();
  toast(`Deleted: ${text}`, {
    label: 'Undo',
    run: onGame(() => {
      game.events.splice(Math.min(i, game.events.length), 0, ev);
      persist();
      render();
      toast('Entry restored');
    }),
  });
}

/* ------------------------------------------------------------------ dialogs */

const RECORD_NOTE = 'The scoresheet is the official record — only record this if it is what actually happened.';

/**
 * Asks before doing something: a rule warning by default, or (with options) an
 * irreversible game step. warnings may be empty when there is only a question.
 */
function confirmDialog(
  warnings,
  onOk,
  { title = 'Check this entry', body = RECORD_NOTE, ok: okLabel = 'Record anyway', onCancel, extra = '' } = {},
) {
  const dlg = $('#dlg-confirm');
  $('#confirm-title').textContent = title;
  const box = $('#confirm-warnings');
  box.hidden = !warnings.length;
  box.innerHTML = `<ul class="m-0 list-disc pl-4">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
  $('#confirm-body').textContent = body;
  // Optional fields under the question, read by onOk (which receives the dialog).
  $('#confirm-extra').innerHTML = extra;
  const ok = $('#confirm-ok');
  const cancel = $('#confirm-cancel');
  ok.textContent = okLabel;
  const close = () => {
    dlg.close();
    ok.onclick = cancel.onclick = null;
  };
  ok.onclick = () => {
    close();
    onOk(dlg);
  };
  cancel.onclick = () => {
    close();
    onCancel?.();
  };
  dlg.showModal();
}

/**
 * The minute of play a time-out was granted in, as the paper form records it:
 * 1 to 10 in regulation, 1 to 5 in an extra period. Skip records it with no minute.
 */
function timeoutDialog({ title, period, onOk }) {
  const dlg = $('#dlg-timeout');
  $('#timeout-title').textContent = title;
  const minutes = period > 4 ? 5 : 10;
  $('#timeout-minutes').innerHTML = Array.from(
    { length: minutes },
    (_, i) => `<button class="choice-btn tabular-nums" data-min="${i + 1}">${i + 1}</button>`,
  ).join('');
  const close = () => dlg.close();
  const pick = (minute) => () => {
    close();
    onOk(minute);
  };
  $$('#timeout-minutes button').forEach((b) => (b.onclick = pick(b.dataset.min)));
  $('#timeout-skip').onclick = pick('');
  $('#timeout-cancel').onclick = close;
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

function logDialog() {
  const dlg = $('#dlg-log');
  const paint = () => {
    const rows = describeEvents(game).slice().reverse();
    $('#log-title').textContent = `Entries (${rows.length})`;
    $('#log-list').innerHTML =
      rows
        .map(
          ({ ev, text }) =>
            `<li class="log-row"><span class="flex-1">${esc(text)}</span><button class="btn btn-ghost btn-icon" data-del="${esc(ev.id)}" aria-label="Delete entry: ${esc(text)}">${X_ICON}</button></li>`,
        )
        .join('') || '<li class="log-row text-muted">Nothing recorded yet.</li>';
    $$('[data-del]', dlg).forEach((b) => {
      b.onclick = () => {
        removeEvent(b.dataset.del);
        paint();
      };
    });
  };
  paint();
  // A restored entry (Undo in the toast) should show up while the log is open.
  dlg.repaint = paint;
  $('#log-close').onclick = () => dlg.close();
  dlg.showModal();
}

let toastTimer;
/** A short message, optionally with one action button such as Undo. */
function toast(msg, action) {
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = msg;
  el.append(text);
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-act';
    b.textContent = action.label;
    b.onclick = () => {
      el.remove();
      action.run();
      $('#dlg-log').repaint?.();
    };
    el.append(b);
  }
  // An open modal sits in the top layer, above anything in <body>.
  ($('dialog[open]') ?? document.body).append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), action ? 6000 : 2600);
}

function helpDialog() {
  const links = [`<a href="../${VIDEO}" target="_blank" rel="noopener">Watch the short video</a>`];
  const fb = feedbackUrl(VERSION);
  if (fb) links.push(`<a href="${esc(fb)}" target="_blank" rel="noopener">Send feedback</a>`);
  $('#help-links').innerHTML = `${links.join(' · ')}<br><span class="text-muted">Version ${esc(VERSION)}</span>`;
  $('#help-close').onclick = () => $('#dlg-help').close();
  store.set(HELP_SEEN, '1');
  $('#dlg-help').showModal();
}

/* ------------------------------------------------------------------ setup view */

function setupView() {
  const i = game.info;
  const o = game.officials;
  const f = (label, path, type = 'text', extra = '') => {
    const [grp, key] = path.split('.');
    const val = grp === 'info' ? i[key] : o[key];
    return `<label class="field">${label}
      <input type="${type}" data-bind="${path}" value="${esc(val)}"${extra}></label>`;
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
        <thead><tr class="text-left text-xs font-normal text-muted">
          <th class="w-16 p-1 font-normal">No.</th>
          <th class="p-1 font-normal">Player</th>
          <th class="w-10 p-1 text-center font-normal" title="Starting five">St</th>
          <th class="w-20 p-1 font-normal">Licence <span class="font-normal">(optional)</span></th>
          <th class="p-1"></th>
        </tr></thead>
        <tbody>
          ${game.teams[k].players
            .map(
              (p, idx) => `<tr data-pid="${esc(p.id)}">
            <td class="px-0.5 py-1"><input type="text" data-player="${k}.${idx}.no" value="${esc(p.no)}" inputmode="numeric" placeholder="#" aria-label="Shirt number"></td>
            <td class="px-0.5 py-1"><input type="text" data-player="${k}.${idx}.name" value="${esc(p.name)}" placeholder="Name" aria-label="Player name"></td>
            <td class="px-0.5 py-1 text-center"><input type="checkbox" data-player="${k}.${idx}.starter" ${p.starter ? 'checked' : ''} aria-label="Starter"></td>
            <td class="px-0.5 py-1"><input type="text" data-player="${k}.${idx}.licence" value="${esc(p.licence)}" aria-label="Licence number"></td>
            <td class="px-0.5 py-1"><button class="btn btn-ghost btn-icon" data-delrow="${k}.${idx}" aria-label="Clear row">${X_ICON}</button></td>
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
        <div class="col-span-full">
          ${f('Sheet heading', 'info.heading', 'text', ' placeholder="Tournament or federation name"')}
          <p class="${HINT}">Printed at the top of the sheet. New games start with the last heading used.</p>
        </div>
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
      if (el.dataset.bind === 'info.heading') store.set(HEADING, el.value);
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
        toast('That player already has entries on the sheet');
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
  $('#go-live', root).onclick = goLive;
}

/** Leave Setup for Live, checking the rosters first if scoring has not begun. */
function goLive() {
  const go = () => {
    tab = 'live';
    render();
  };
  const w = game.events.length ? [] : setupWarnings(game);
  if (!w.length) return go();
  confirmDialog(w, go, {
    title: 'Check the setup',
    body: 'You can start anyway and fix these on Setup later.',
    ok: 'Start anyway',
  });
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
          const id = esc(p.id);
          const no = esc(p.no || '?');
          return `<div class="pcard${s.out ? ' pcard-out' : ''}">
        <div class="flex items-baseline gap-1.5">
          <span class="min-w-7 text-lg font-semibold tabular-nums">${esc(p.no || '–')}</span>
          <span class="flex-1 truncate text-xs text-muted">${esc(p.name)}</span>
        </div>
        <div class="mt-1 flex gap-3 text-xs text-muted">
          <span>Pts <b class="text-text">${s.points}</b></span>
          <span>Fouls <b class="text-text">${s.fouls.length}</b></span>
          ${s.out ? '<span class="font-medium text-danger-text">Out</span>' : ''}
        </div>
        <div class="mt-2 grid grid-cols-4 gap-1">
          <button class="pcard-act" data-sc="${id}.1" aria-label="Free throw made, number ${no}">+1</button>
          <button class="pcard-act" data-sc="${id}.2" aria-label="2 points, number ${no}">+2</button>
          <button class="pcard-act" data-sc="${id}.3" aria-label="3 points, number ${no}">+3</button>
          <button class="pcard-act" data-foul="${id}" aria-label="Foul, number ${no}">F</button>
        </div>
      </div>`;
        })
        .join('')
    : `<p class="${HINT}">No players entered yet — add them on the <b>Setup</b> tab.</p>`;

  // Each team's score doubles as the switch for which roster is shown.
  const side = (x) => `<button class="score-side" data-team="${x}" aria-pressed="${x === k}">
      <span class="block truncate text-sm">${esc(teamName(game, x))}</span>
      <span class="mt-1 block text-[40px] leading-none font-medium text-text tabular-nums">${d.teams[x].score}</span>
    </button>`;

  return `
    <div class="live-top">
      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
        ${side('A')}
        <div class="min-w-14 text-xs text-muted">
          <div class="text-lg font-medium text-text">${d.ended ? 'Final' : periodLabel(d.period)}</div>
          <div>${d.ended ? 'closed' : d.period > 4 ? 'extra' : 'period'}</div>
        </div>
        ${side('B')}
      </div>
      <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span class="stat${tf >= 4 ? ' stat-warn' : ''}">Team fouls ${periodLabel(Math.min(d.period, 4))} <b>${tf}</b>${tf >= 4 ? ' · bonus' : ''}</span>
        <span class="stat${toUsed >= g.allowed ? ' stat-warn' : ''}">Time-outs <b>${toUsed}/${g.allowed}</b></span>
        ${t.coach.out ? '<span class="stat stat-warn">Coach disqualified</span>' : ''}
      </div>
    </div>

    <div class="mb-4 grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-2">${cards}</div>

    <div class="card">
      <h2 class="card-title">${esc(teamName(game, k))} bench</h2>
      <div class="${CTL}">
        <button class="btn" id="btn-timeout">Time-out</button>
        <button class="btn" id="btn-coach-foul">Coach foul</button>
        <button class="btn" id="btn-asst-foul">Bench foul</button>
      </div>
    </div>
    ${d.ended ? `<p class="${HINT}">Game closed. Open the <b>Sheet</b> tab to export the PDF.</p>` : ''}`;
}

/** Always-visible controls under the live screen, outside the scrolling area. */
function liveBar() {
  const d = derive(game);
  const n = game.events.length;
  return `
    <button class="btn" id="btn-undo"${n ? '' : ' disabled'}>Undo</button>
    <button class="btn" id="btn-log">Log${n ? ` (${n})` : ''}</button>
    <button class="btn" id="btn-end-period"${d.ended ? ' disabled' : ''}>End ${periodLabel(d.period)}</button>
    <button class="btn btn-primary" id="btn-end-game"${d.ended ? ' disabled' : ''}>End game</button>`;
}

function bindLive(root, bar) {
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

  $('#btn-timeout', root).onclick = () =>
    timeoutDialog({
      title: `Time-out — ${teamName(game, liveTeam)}`,
      period: derive(game).period,
      onOk: (minute) => pushEvent({ t: 'timeout', team: liveTeam, minute }),
    });
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

  $('#btn-undo', bar).onclick = undoLast;
  $('#btn-log', bar).onclick = logDialog;
  $('#btn-end-period', bar).onclick = () => {
    const d = derive(game);
    confirmDialog(
      [],
      () => {
        commit({ id: uid(), at: Date.now(), t: 'endPeriod', team: 'A', period: d.period });
        toast(`${periodName(d.period)} closed`);
      },
      {
        title: `End ${periodName(d.period).toLowerCase()}?`,
        body: `${teamName(game, 'A')} ${d.teams.A.score}–${d.teams.B.score} ${teamName(game, 'B')}. You can undo this.`,
        ok: `End ${periodLabel(d.period)}`,
      },
    );
  };
  $('#btn-end-game', bar).onclick = () => {
    const d = derive(game);
    const warn = [];
    if (d.teams.A.score === d.teams.B.score) warn.push('The score is level — a basketball game cannot end in a tie.');
    if (d.period < 4) warn.push(`Only ${d.period - 1} of 4 periods have been closed.`);
    const finish = (dlg) => {
      // A protest is noted on the sheet; the captain signs the printed copy.
      game.protest = $('#protest-on', dlg).checked ? $('#protest-note', dlg).value.trim() || 'Protest lodged' : '';
      // Only close the period if "End <period>" was not already pressed, so the
      // game does not get credited with an extra empty period.
      const last = game.events[game.events.length - 1];
      if (last?.t !== 'endPeriod') {
        game.events.push({ id: uid(), at: Date.now(), t: 'endPeriod', team: 'A', period: d.period });
      }
      commit({ id: uid(), at: Date.now(), t: 'endGame', team: 'A', period: derive(game).period });
      tab = 'sheet';
      render();
    };
    confirmDialog(warn, finish, {
      title: 'End the game?',
      body: `Final score ${teamName(game, 'A')} ${d.teams.A.score}–${d.teams.B.score} ${teamName(game, 'B')}. You can undo this.`,
      ok: 'End game',
      extra: `
        <label class="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" id="protest-on"${game.protest ? ' checked' : ''}> A team is playing under protest
        </label>
        <label class="field mt-2">Protest note (optional)
          <input type="text" id="protest-note" value="${esc(game.protest)}" placeholder="Team and reason"></label>`,
    });
  };
}

/* ------------------------------------------------------------------ sheet view */

function sheetView() {
  const d = derive(game);
  const share = canShareFiles();
  return `
    <div class="card">
      <h2 class="card-title">Export</h2>
      <div class="${ROW}">
        ${share ? '<button class="btn btn-primary" id="btn-share">Share PDF</button>' : ''}
        <button class="btn${share ? '' : ' btn-primary'}" id="btn-pdf">Download PDF</button>
        <button class="btn" id="btn-json">Save game file</button>
      </div>
      <p class="${HINT}">
        An A4 PDF of the sheet${share ? ', ready to send on WhatsApp, by email or to print' : ''}. Officials sign the printed copy.
        The game file keeps a copy you can import on any phone.
        ${d.ended ? '' : '<br>The game is not closed yet, so the final score and winner are left blank.'}
      </p>
    </div>
    <div class="card">
      <h2 class="card-title">Preview</h2>
      <div class="preview-wrap"><div id="preview"></div></div>
    </div>`;
}

function bindSheet(root) {
  $('#preview', root).innerHTML = renderSheet(game);
  // Made now, so a tap on Share has the file at once: phones only allow
  // sharing straight after a tap, not after waiting for a PDF to be built.
  const pdf = makePdf(game);
  pdf.catch(() => {});
  const run = (btn, action) => async () => {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Making PDF…';
    try {
      await action(await pdf);
    } catch (e) {
      if (e?.name !== 'AbortError') toast('Could not make the PDF');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };
  const share = $('#btn-share', root);
  if (share) {
    share.onclick = run(share, (file) => navigator.share({ files: [file], title: file.name }));
  }
  const download = $('#btn-pdf', root);
  download.onclick = run(download, (file) => saveFile(file, file.name));
  $('#btn-json', root).onclick = exportJson;
}

const canShareFiles = () => {
  try {
    return Boolean(navigator.canShare?.({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }));
  } catch {
    return false;
  }
};

function saveFile(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** e.g. Hawks-v-Lions-2026-07-18.pdf, keeping letters from any language. */
function pdfName(g) {
  const part = (s) => s.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `${[part(teamName(g, 'A')), 'v', part(teamName(g, 'B')), part(g.info.date || '')].filter(Boolean).join('-')}.pdf`;
}

// jsPDF, svg2pdf and the Figtree TTFs (jsPDF embeds TrueType only) load on the
// first export, from the app's own files, so they also work offline.
let pdfLibs = null;

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(s);
  });

async function base64(url) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function loadPdfLibs() {
  pdfLibs ??= (async () => {
    if (!globalThis.jspdf) await loadScript('vendor/jspdf.umd.min.js');
    if (!globalThis.svg2pdf) await loadScript('vendor/svg2pdf.umd.min.js');
    const [regular, semibold] = await Promise.all([
      base64('../fonts/Figtree-Regular.ttf'),
      base64('../fonts/Figtree-SemiBold.ttf'),
    ]);
    return { jsPDF: globalThis.jspdf.jsPDF, regular, semibold };
  })();
  // A failed load (say, a broken connection on first use) is retried next time.
  pdfLibs.catch(() => (pdfLibs = null));
  return pdfLibs;
}

async function makePdf(g) {
  const { jsPDF, regular, semibold } = await loadPdfLibs();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('Figtree-Regular.ttf', regular);
  doc.addFont('Figtree-Regular.ttf', 'Figtree', 'normal');
  doc.addFileToVFS('Figtree-SemiBold.ttf', semibold);
  doc.addFont('Figtree-SemiBold.ttf', 'Figtree', 'bold');
  const name = pdfName(g);
  doc.setProperties({ title: name.replace(/\.pdf$/, '').replaceAll('-', ' '), creator: 'Basketball Scoresheet' });
  // svg2pdf measures the SVG, so it has to be in the document while it converts.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm';
  host.innerHTML = renderSheet(g);
  document.body.append(host);
  try {
    await doc.svg(host.firstElementChild, { x: 0, y: 0, width: 210, height: 297 });
  } finally {
    host.remove();
  }
  return new File([doc.output('blob')], name, { type: 'application/pdf' });
}

function exportJson() {
  const blob = new Blob([JSON.stringify(game, null, 2)], { type: 'application/json' });
  saveFile(blob, `scoresheet-${(game.info.gameNo || game.id).toString().replace(/\W+/g, '')}.json`);
}

/* ------------------------------------------------------------------ games dialog */

function gamesDialog() {
  const dlg = $('#dlg-games');
  const list = $('#games-list');
  games = readStored();
  const paint = () => {
    list.innerHTML = `
      <div class="${ROW} mb-3">
        <button class="btn btn-primary btn-sm" id="new-game">New game</button>
      </div>
      <ul class="m-0 max-h-80 list-none overflow-y-auto p-0">
        ${games
          .map((g) => {
            const d = derive(g);
            return `<li class="log-row">
              <span class="flex-1"><b>${esc(teamName(g, 'A'))} ${d.teams.A.score}–${d.teams.B.score} ${esc(teamName(g, 'B'))}</b>
              <br><span class="text-muted">${esc(g.info.date || '')} ${esc(g.info.competition || '')} · ${d.ended ? 'final' : periodLabel(d.period)}</span></span>
              <button class="btn btn-sm" data-open="${esc(g.id)}">Open</button>
              <button class="btn btn-ghost btn-icon btn-danger" data-drop="${esc(g.id)}" aria-label="Delete game">${X_ICON}</button>
            </li>`;
          })
          .join('') || '<li class="log-row text-muted">No saved games.</li>'}
      </ul>`;
    $('#new-game', list).onclick = () => {
      dlg.close();
      openGame(freshGame());
    };
    $$('[data-open]', list).forEach((b) => {
      b.onclick = () => {
        dlg.close();
        openGame(games.find((g) => g.id === b.dataset.open));
      };
    });
    $$('[data-drop]', list).forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.drop;
        const g = games.find((x) => x.id === id);
        dlg.close();
        confirmDialog(
          [],
          () => {
            dropGame(id);
            if (game.id === id) openGame(games[0] || freshGame());
            paint();
            dlg.showModal();
          },
          {
            title: 'Delete this game?',
            body: `${teamName(g, 'A')} v ${teamName(g, 'B')} will be removed from this phone. This cannot be undone.`,
            ok: 'Delete',
            // Cancelling returns to the list rather than closing everything.
            onCancel: () => dlg.showModal(),
          },
        );
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
    const data = normalizeGame(JSON.parse(await file.text()));
    if (!data) throw new Error('shape');
    data.id = uid();
    $('#dlg-games').close();
    openGame(data);
    toast('Game imported');
  } catch {
    toast('That file is not a saved scoresheet');
  }
};

/* ------------------------------------------------------------------ updates */

// A new release never replaces the app mid-game. sw.js keeps serving the
// release a game started on; this page reports whether a game is open and
// offers the reload only once none is.
let waitingWorker = null;
let latestRelease = null;
let reportedOpen = null;
let reloading = false;

function reportGameOpen() {
  const open = isOpen(game);
  if (open === reportedOpen) return;
  reportedOpen = open;
  navigator.serviceWorker?.controller?.postMessage({ type: 'game-open', open });
  if (!open) navigator.serviceWorker?.controller?.postMessage({ type: 'status' });
  paintUpdateBar();
}

function paintUpdateBar() {
  const newer = waitingWorker || (latestRelease && latestRelease !== `scoresheet-${VERSION}`);
  const show = Boolean(newer) && !isOpen(game);
  $('#update-bar').classList.toggle('hidden', !show);
  $('#update-bar').classList.toggle('flex', show);
}

$('#btn-update').onclick = () => {
  if (waitingWorker) {
    reloading = true;
    waitingWorker.postMessage({ type: 'skip-waiting' });
  } else {
    location.reload();
  }
};

async function registerWorker() {
  // Unbuilt source (VERSION 'dev') runs without the worker so edits show on reload.
  if (!('serviceWorker' in navigator) || DEMO || VERSION === 'dev') return;
  const reg = await navigator.serviceWorker.register('sw.js');
  const track = (w) => {
    if (!w) return;
    const check = () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) {
        waitingWorker = w;
        paintUpdateBar();
      }
    };
    w.addEventListener('statechange', check);
    check();
  };
  track(reg.waiting);
  reg.addEventListener('updatefound', () => track(reg.installing));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'status') {
      latestRelease = e.data.latest;
      paintUpdateBar();
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  reportedOpen = null;
  reportGameOpen();
  navigator.serviceWorker.controller?.postMessage({ type: 'status' });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}

/* ------------------------------------------------------------------ shell */

function paintHeader() {
  const d = derive(game);
  $('#subtitle').textContent = game.started
    ? `${teamName(game, 'A')} ${d.teams.A.score}–${d.teams.B.score} ${teamName(game, 'B')} · ${d.ended ? 'final' : periodLabel(d.period)}`
    : 'New game';
}

function render() {
  const view = $('#view');
  const bar = $('#bar');
  const live = tab === 'live';
  view.innerHTML = tab === 'setup' ? setupView() : live ? liveView() : sheetView();
  bar.innerHTML = live ? liveBar() : '';
  bar.classList.toggle('hidden', !live);
  bar.classList.toggle('grid', live);
  document.body.classList.toggle('has-bar', live);
  if (tab === 'setup') bindSetup(view);
  else if (live) bindLive(view, bar);
  else bindSheet(view);
  $$('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.id === `tab-${tab}`)));
  paintHeader();
}

$$('[role="tab"]').forEach((b) => {
  b.onclick = () => {
    const next = b.id.replace('tab-', '');
    if (next === 'live' && tab === 'setup') return goLive();
    tab = next;
    render();
  };
});
$('#btn-games').onclick = gamesDialog;
$('#btn-theme').onclick = cycleTheme;
$('#btn-help').onclick = helpDialog;

// Keep an in-progress game from being lost to an accidental navigation.
window.addEventListener('beforeunload', (e) => {
  if (!DEMO && isOpen(game)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

applyTheme();

// The video recorder hands the demo its game before the page loads.
if (DEMO && globalThis.__DEMO_GAME__) games = [normalizeGame(globalThis.__DEMO_GAME__)];

const lastId = store.get(LAST);
game = games.find((g) => g.id === lastId) || games[0] || freshGame();
tab = game.events.length ? 'live' : 'setup';
persist();
render();
if (!DEMO && !store.get(HELP_SEEN)) helpDialog();

window.addEventListener('load', () => registerWorker().catch(() => {}));
