// Pure scoresheet logic. All sheet state (running score, fouls, time-outs,
// period scores) is derived from game.events, so undoing or deleting an event
// always leaves the sheet consistent.

export const TEAMS = ['A', 'B'];
export const PLAYER_ROWS = 12;
export const PLAYER_FOULS = ['P', 'T', 'U', 'D'];
export const COACH_FOULS = ['C', 'B', 'D'];
export const DEFAULT_FT = { P: 0, T: 1, U: 2, D: 2, C: 1, B: 1 };
// Player fouls count towards the team-foul total; coach (C) and bench (B) ones do not.
const TEAM_FOUL_TYPES = new Set(PLAYER_FOULS);
// Technical-family fouls, tracked per player because two of them disqualify.
const TECHNICAL_TYPES = new Set(['T', 'U', 'D']);

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const periodLabel = (p) => (p <= 4 ? `Q${p}` : `OT${p - 4}`);
export const periodName = (p) => (p <= 4 ? `Period ${p}` : `Extra period ${p - 4}`);

export function newPlayer() {
  return { id: uid(), licence: '', name: '', no: '', starter: false, in: false };
}

export function newTeam() {
  return {
    name: '',
    coach: '',
    assistant: '',
    players: Array.from({ length: PLAYER_ROWS }, newPlayer),
  };
}

export function newGame() {
  const now = Date.now();
  return {
    id: uid(),
    v: 1,
    createdAt: now,
    updatedAt: now,
    started: false,
    info: {
      competition: '',
      gameNo: '',
      place: '',
      date: new Date().toISOString().slice(0, 10),
      time: '',
      referee: '',
      umpire1: '',
      umpire2: '',
    },
    officials: { scorekeeper: '', assistantScorekeeper: '', timekeeper: '', shotClock: '' },
    protest: '',
    teams: { A: newTeam(), B: newTeam() },
    events: [],
  };
}

export const teamName = (game, k) => game.teams[k].name.trim() || `Team ${k}`;

/** Time-outs: 2 in the first half, 3 in the second, 1 per extra period. */
export function timeoutGroup(period) {
  if (period <= 2) return { key: 'h1', allowed: 2, label: 'first half', match: (p) => p <= 2 };
  if (period <= 4) return { key: 'h2', allowed: 3, label: 'second half', match: (p) => p >= 3 && p <= 4 };
  return { key: `ot${period}`, allowed: 1, label: `extra period ${period - 4}`, match: (p) => p === period };
}

export const foulLabel = (ev) => `${ev.type}${ev.ft || ''}`;

export function derive(game) {
  const endPeriods = game.events.filter((e) => e.t === 'endPeriod').length;
  const ended = game.events.some((e) => e.t === 'endGame');
  const period = ended ? Math.max(1, endPeriods) : endPeriods + 1;

  const teams = {};
  for (const k of TEAMS) {
    const players = {};
    for (const p of game.teams[k].players) {
      players[p.id] = {
        points: 0, ft: 0, fg2: 0, fg3: 0,
        fouls: [], T: 0, U: 0, D: 0,
        out: false,
        played: Boolean(p.starter || p.in),
      };
    }
    teams[k] = {
      score: 0,
      byPeriod: {},
      marks: {}, // running-score number -> { pts, no, period }
      endAt: {}, // running-score number -> 'q' (end of period) | 'fin' (end of game)
      teamFouls: { 1: 0, 2: 0, 3: 0, 4: 0 }, // extra-period fouls are added to bucket 4
      extraFouls: 0,
      timeouts: [],
      players,
      coach: { all: [], C: 0, B: 0, D: 0, out: false },
      asst: { fouls: [] },
    };
  }
  const noOf = (k, id) => game.teams[k].players.find((p) => p.id === id)?.no ?? '';

  for (const ev of game.events) {
    const t = teams[ev.team];
    if (ev.t === 'score') {
      t.score += ev.pts;
      t.byPeriod[ev.period] = (t.byPeriod[ev.period] || 0) + ev.pts;
      t.marks[t.score] = { pts: ev.pts, no: noOf(ev.team, ev.player), period: ev.period };
      const p = t.players[ev.player];
      if (p) {
        p.points += ev.pts;
        p.played = true;
        if (ev.pts === 1) p.ft++;
        else if (ev.pts === 2) p.fg2++;
        else p.fg3++;
      }
    } else if (ev.t === 'foul') {
      if (ev.who === 'coach' || ev.who === 'asst') {
        t.coach.all.push(ev);
        if (ev.who === 'asst') t.asst.fouls.push(ev);
        if (ev.type === 'C' && ev.who === 'coach') t.coach.C++;
        else if (ev.type === 'D') t.coach.D++;
        else t.coach.B++;
        // Disqualified on: a D, two C, or three technicals in total.
        t.coach.out = t.coach.D > 0 || t.coach.C >= 2 || t.coach.C + t.coach.B >= 3;
      } else {
        const p = t.players[ev.player];
        if (p) {
          p.fouls.push(ev);
          p.played = true;
          if (TECHNICAL_TYPES.has(ev.type)) p[ev.type]++;
          // Out on: 5 fouls, a D, or two of T/U in any mix.
          p.out = p.fouls.length >= 5 || p.D > 0 || p.T + p.U >= 2;
        }
        if (TEAM_FOUL_TYPES.has(ev.type)) {
          t.teamFouls[Math.min(ev.period, 4)]++;
          if (ev.period > 4) t.extraFouls++;
        }
      }
    } else if (ev.t === 'timeout') {
      t.timeouts.push({ period: ev.period, minute: ev.minute });
    } else if (ev.t === 'endPeriod') {
      for (const k of TEAMS) {
        const s = teams[k].score;
        if (s > 0 && teams[k].endAt[s] !== 'fin') teams[k].endAt[s] = 'q';
      }
    } else if (ev.t === 'endGame') {
      for (const k of TEAMS) if (teams[k].score > 0) teams[k].endAt[teams[k].score] = 'fin';
    }
  }

  const a = teams.A.score;
  const b = teams.B.score;
  const winner = ended && a !== b ? (a > b ? 'A' : 'B') : null;
  return { period, ended, teams, winner };
}

export function timeoutsUsed(team, period) {
  const g = timeoutGroup(period);
  return team.timeouts.filter((t) => g.match(t.period)).length;
}

/**
 * Points in each of periods 1-4, plus all extra periods combined.
 * A period still in progress reads as null so the sheet leaves its box blank.
 */
export function periodScores(team, period, ended) {
  const done = (p) => ended || p < period;
  const periods = [1, 2, 3, 4].map((p) => (done(p) ? (team.byPeriod[p] ?? 0) : null));
  const anyExtra = ended ? period >= 5 : period > 5;
  const extra = anyExtra
    ? Object.entries(team.byPeriod).reduce(
        (sum, [p, v]) => (Number(p) > 4 && done(Number(p)) ? sum + v : sum),
        0,
      )
    : null;
  return { periods, extra };
}

/** Problems worth confirming before an entry is added. Empty when it looks fine. */
export function warningsFor(game, d, ev) {
  const w = [];
  const team = d.teams[ev.team];
  const label = teamName(game, ev.team);
  if (d.ended) w.push('The game has already been closed. Undo the final entry to reopen it.');
  if ((ev.t === 'score' || (ev.t === 'foul' && ev.player)) && team.players[ev.player]?.out) {
    const no = game.teams[ev.team].players.find((p) => p.id === ev.player)?.no;
    w.push(`${label} #${no} is already out of the game (5 fouls or disqualified).`);
  }
  if (ev.t === 'foul' && ev.who !== 'player' && team.coach.out) {
    w.push(`${label}'s coach has already been disqualified.`);
  }
  if (ev.t === 'timeout') {
    const g = timeoutGroup(d.period);
    if (timeoutsUsed(team, d.period) >= g.allowed) {
      w.push(`${label} has already used all ${g.allowed} time-out${g.allowed > 1 ? 's' : ''} for the ${g.label}.`);
    }
  }
  return w;
}

/** One human-readable line per event, with the running score after it. */
export function describeEvents(game) {
  const scores = { A: 0, B: 0 };
  return game.events.map((ev) => {
    const name = teamName(game, ev.team ?? 'A');
    const player = ev.player && game.teams[ev.team]?.players.find((p) => p.id === ev.player);
    const who = player ? `#${player.no}${player.name ? ' ' + player.name : ''}` : '';
    let text;
    switch (ev.t) {
      case 'score':
        scores[ev.team] += ev.pts;
        text = `${name} ${who} +${ev.pts} (${ev.pts === 1 ? 'free throw' : ev.pts === 2 ? '2-pt' : '3-pt'}) → ${scores.A}–${scores.B}`;
        break;
      case 'foul': {
        const target = ev.who === 'coach' ? 'coach' : ev.who === 'asst' ? 'assistant coach' : who;
        text = `${name} ${target} foul ${foulLabel(ev)}`;
        break;
      }
      case 'timeout':
        text = `${name} time-out${ev.minute !== '' && ev.minute != null ? ` (minute ${ev.minute})` : ''}`;
        break;
      case 'endPeriod':
        text = `End of ${periodName(ev.period).toLowerCase()} (${scores.A}–${scores.B})`;
        break;
      case 'endGame':
        text = `Game closed (${scores.A}–${scores.B})`;
        break;
      default:
        text = ev.t;
    }
    return { ev, text };
  });
}

/** Loose shape check for imported files. */
export function isGame(x) {
  return Boolean(
    x && typeof x === 'object' && Array.isArray(x.events) && x.info && x.teams?.A?.players && x.teams?.B?.players,
  );
}
