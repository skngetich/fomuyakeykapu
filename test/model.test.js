// Rules the scoresheet has to get right, pinned down. model.js is pure and
// DOM-free, so this runs under `node --test` with nothing installed.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  newGame, uid, derive, timeoutGroup, timeoutsUsed, periodScores,
  warningsFor, describeEvents, isGame, teamName,
} from '../model.js';

/* ---------------------------------------------------------------- helpers */

/** A game with both teams numbered 4..15, so events can address players by index. */
function game() {
  const g = newGame();
  g.teams.A.name = 'Hawks';
  g.teams.B.name = 'Lions';
  for (const k of ['A', 'B']) {
    g.teams[k].players.forEach((p, i) => {
      p.no = String(4 + i);
      p.name = `${k}${i}`;
      p.starter = i < 5;
    });
  }
  return g;
}

const pid = (g, team, i) => g.teams[team].players[i].id;
const add = (g, ev) => (g.events.push({ id: uid(), at: 0, ...ev }), g);
const score = (g, team, i, pts, period = 1) =>
  add(g, { t: 'score', team, player: pid(g, team, i), pts, period });
const foul = (g, team, i, type = 'P', period = 1) =>
  add(g, { t: 'foul', who: 'player', team, player: pid(g, team, i), type, ft: 0, period });
const benchFoul = (g, team, who, type, period = 1) =>
  add(g, { t: 'foul', who, team, type, ft: 1, period });
const timeout = (g, team, period) => add(g, { t: 'timeout', team, period });
const endPeriod = (g, period) => add(g, { t: 'endPeriod', team: 'A', period });
const endGame = (g, period) => add(g, { t: 'endGame', team: 'A', period });
const playerOf = (g, team, i) => derive(g).teams[team].players[pid(g, team, i)];

/* ---------------------------------------------------------------- scoring */

test('field goals and free throws accumulate into the running score', () => {
  const g = game();
  score(g, 'A', 0, 2);
  score(g, 'A', 0, 3);
  score(g, 'A', 1, 1);
  score(g, 'B', 0, 2);

  const d = derive(g);
  assert.equal(d.teams.A.score, 6);
  assert.equal(d.teams.B.score, 2);

  const p0 = d.teams.A.players[pid(g, 'A', 0)];
  assert.equal(p0.points, 5);
  assert.equal(p0.fg2, 1);
  assert.equal(p0.fg3, 1);
  assert.equal(p0.ft, 0);
  assert.equal(d.teams.A.players[pid(g, 'A', 1)].ft, 1);
});

test('each running-score total records the shot that produced it', () => {
  const g = game();
  score(g, 'A', 0, 2); // total 2
  score(g, 'A', 1, 3); // total 5
  score(g, 'A', 2, 1); // total 6

  const marks = derive(g).teams.A.marks;
  assert.deepEqual(marks[2], { pts: 2, no: '4', period: 1 });
  assert.deepEqual(marks[5], { pts: 3, no: '5', period: 1 });
  assert.deepEqual(marks[6], { pts: 1, no: '6', period: 1 });
  assert.equal(marks[3], undefined, 'totals that were never reached stay unmarked');
});

test('scoring is attributed to the period it happened in', () => {
  const g = game();
  score(g, 'A', 0, 2, 1);
  endPeriod(g, 1);
  score(g, 'A', 0, 3, 2);

  const t = derive(g).teams.A;
  assert.equal(t.byPeriod[1], 2);
  assert.equal(t.byPeriod[2], 3);
});

/* ---------------------------------------------------------------- fouls */

test('a fifth foul puts a player out', () => {
  const g = game();
  for (let i = 0; i < 4; i++) foul(g, 'A', 0);
  assert.equal(playerOf(g, 'A', 0).out, false, 'four fouls is still in the game');

  foul(g, 'A', 0);
  const p = playerOf(g, 'A', 0);
  assert.equal(p.fouls.length, 5);
  assert.equal(p.out, true);
});

test('two technical-family fouls disqualify before the fifth foul', () => {
  const g = game();
  foul(g, 'A', 0, 'T');
  assert.equal(playerOf(g, 'A', 0).out, false);
  foul(g, 'A', 0, 'U');
  assert.equal(playerOf(g, 'A', 0).out, true, 'a T and a U together disqualify');
});

test('a single D disqualifies immediately', () => {
  const g = game();
  foul(g, 'A', 0, 'D');
  assert.equal(playerOf(g, 'A', 0).out, true);
});

test('player fouls count towards the team total, bench fouls do not', () => {
  const g = game();
  foul(g, 'A', 0, 'P');
  foul(g, 'A', 1, 'T');
  benchFoul(g, 'A', 'coach', 'C');
  benchFoul(g, 'A', 'asst', 'B');

  const t = derive(g).teams.A;
  assert.equal(t.teamFouls[1], 2, 'only the two player fouls count');
  assert.equal(t.coach.C, 1);
  assert.equal(t.coach.B, 1);
});

test('team fouls are counted per period and reset each one', () => {
  const g = game();
  foul(g, 'A', 0, 'P', 1);
  foul(g, 'A', 1, 'P', 1);
  endPeriod(g, 1);
  foul(g, 'A', 2, 'P', 2);

  const t = derive(g).teams.A;
  assert.equal(t.teamFouls[1], 2);
  assert.equal(t.teamFouls[2], 1);
});

test('extra-period team fouls are added to the fourth-period column', () => {
  const g = game();
  for (let p = 1; p <= 4; p++) endPeriod(g, p);
  foul(g, 'A', 0, 'P', 5);

  const t = derive(g).teams.A;
  assert.equal(t.extraFouls, 1);
  assert.equal(t.teamFouls[4], 1, 'FIBA carries extra-period fouls in the last column');
});

test('a coach is disqualified by two C fouls, three technicals, or one D', () => {
  const twoC = game();
  benchFoul(twoC, 'A', 'coach', 'C');
  assert.equal(derive(twoC).teams.A.coach.out, false);
  benchFoul(twoC, 'A', 'coach', 'C');
  assert.equal(derive(twoC).teams.A.coach.out, true);

  const threeTotal = game();
  benchFoul(threeTotal, 'A', 'coach', 'C');
  benchFoul(threeTotal, 'A', 'asst', 'B');
  assert.equal(derive(threeTotal).teams.A.coach.out, false);
  benchFoul(threeTotal, 'A', 'asst', 'B');
  assert.equal(derive(threeTotal).teams.A.coach.out, true);

  const straightD = game();
  benchFoul(straightD, 'A', 'coach', 'D');
  assert.equal(derive(straightD).teams.A.coach.out, true);
});

/* ---------------------------------------------------------------- time-outs */

test('time-out allowance is 2 in the first half, 3 in the second, 1 per extra period', () => {
  assert.equal(timeoutGroup(1).allowed, 2);
  assert.equal(timeoutGroup(2).allowed, 2);
  assert.equal(timeoutGroup(3).allowed, 3);
  assert.equal(timeoutGroup(4).allowed, 3);
  assert.equal(timeoutGroup(5).allowed, 1);
  assert.equal(timeoutGroup(6).allowed, 1);
});

test('time-outs are pooled across each half, not per period', () => {
  const g = game();
  timeout(g, 'A', 1);
  timeout(g, 'A', 2);
  const t = derive(g).teams.A;

  assert.equal(timeoutsUsed(t, 1), 2);
  assert.equal(timeoutsUsed(t, 2), 2, 'one taken in period 1 still counts in period 2');
  assert.equal(timeoutsUsed(t, 3), 0, 'the second half starts fresh');
});

test('each extra period carries its own single time-out', () => {
  const g = game();
  timeout(g, 'A', 5);
  const t = derive(g).teams.A;
  assert.equal(timeoutsUsed(t, 5), 1);
  assert.equal(timeoutsUsed(t, 6), 0);
});

/* ---------------------------------------------------------------- periods */

test('the current period follows the closed-period count', () => {
  const g = game();
  assert.equal(derive(g).period, 1);
  endPeriod(g, 1);
  assert.equal(derive(g).period, 2);
  for (const p of [2, 3, 4]) endPeriod(g, p);
  assert.equal(derive(g).period, 5, 'after four periods the game is in extra time');
});

test('period scores separate regulation from extra time', () => {
  const g = game();
  for (let p = 1; p <= 4; p++) {
    score(g, 'A', 0, 2, p);
    endPeriod(g, p);
  }
  score(g, 'A', 0, 3, 5);
  endPeriod(g, 5);
  endGame(g, 5);

  const d = derive(g);
  const ps = periodScores(d.teams.A, d.period, d.ended);
  assert.deepEqual(ps.periods, [2, 2, 2, 2]);
  assert.equal(ps.extra, 3);
  assert.equal(d.teams.A.score, 11);
});

test('a period still being played reads as blank, not zero', () => {
  const g = game();
  score(g, 'A', 0, 2, 1);
  const d = derive(g);
  const ps = periodScores(d.teams.A, d.period, d.ended);
  assert.equal(ps.periods[0], null, 'period 1 is in progress');
  assert.equal(ps.extra, null);
});

test('closing a period and the game marks the right running-score totals', () => {
  const g = game();
  score(g, 'A', 0, 2); // 2
  endPeriod(g, 1);
  score(g, 'A', 0, 3, 2); // 5
  endGame(g, 2);

  const t = derive(g).teams.A;
  assert.equal(t.endAt[2], 'q', 'end of period 1 is ruled under the total 2');
  assert.equal(t.endAt[5], 'fin', 'the final total is boxed');
});

test('the winner is only decided once the game is closed', () => {
  const g = game();
  score(g, 'A', 0, 2);
  assert.equal(derive(g).winner, null, 'leading is not winning');

  endGame(g, 1);
  const d = derive(g);
  assert.equal(d.ended, true);
  assert.equal(d.winner, 'A');
  assert.equal(teamName(g, d.winner), 'Hawks');
});

test('a closed game level on points has no winner', () => {
  const g = game();
  score(g, 'A', 0, 2);
  score(g, 'B', 0, 2);
  endGame(g, 1);
  assert.equal(derive(g).winner, null);
});

/* ---------------------------------------------------------------- warnings */

test('scoring for a player who has fouled out is flagged', () => {
  const g = game();
  for (let i = 0; i < 5; i++) foul(g, 'A', 0);
  const d = derive(g);
  const w = warningsFor(g, d, { t: 'score', team: 'A', player: pid(g, 'A', 0), pts: 2 });
  assert.equal(w.length, 1);
  assert.match(w[0], /out of the game/);
});

test('an extra time-out in a half is flagged', () => {
  const g = game();
  timeout(g, 'A', 1);
  timeout(g, 'A', 1);
  const d = derive(g);
  const w = warningsFor(g, d, { t: 'timeout', team: 'A' });
  assert.equal(w.length, 1);
  assert.match(w[0], /already used all 2 time-outs/);
});

test('entries after the game is closed are flagged', () => {
  const g = game();
  endGame(g, 1);
  const d = derive(g);
  const w = warningsFor(g, d, { t: 'score', team: 'A', player: pid(g, 'A', 0), pts: 2 });
  assert.ok(w.some((x) => /already been closed/.test(x)));
});

test('a legal entry produces no warnings', () => {
  const g = game();
  const d = derive(g);
  assert.deepEqual(warningsFor(g, d, { t: 'score', team: 'A', player: pid(g, 'A', 0), pts: 2 }), []);
});

/* ---------------------------------------------------------------- integrity */

test('deleting an entry recomputes the whole sheet', () => {
  const g = game();
  score(g, 'A', 0, 2);
  score(g, 'A', 1, 3);
  score(g, 'A', 2, 2);
  const before = derive(g);
  assert.equal(before.teams.A.score, 7);
  assert.deepEqual(before.teams.A.marks[5], { pts: 3, no: '5', period: 1 });

  // Remove the middle basket: everything after it must shift down.
  g.events.splice(1, 1);
  const after = derive(g);
  assert.equal(after.teams.A.score, 4);
  assert.equal(after.teams.A.marks[5], undefined, 'the stale mark is gone');
  assert.deepEqual(after.teams.A.marks[4], { pts: 2, no: '6', period: 1 });
  assert.equal(after.teams.A.players[pid(g, 'A', 1)].points, 0);
});

test('undoing the last entry reopens a closed game', () => {
  const g = game();
  score(g, 'A', 0, 2);
  endGame(g, 1);
  assert.equal(derive(g).ended, true);

  g.events.pop();
  assert.equal(derive(g).ended, false);
  assert.equal(derive(g).winner, null);
});

test('the entry log reads back with a running score', () => {
  const g = game();
  score(g, 'A', 0, 2);
  score(g, 'B', 0, 3);
  const lines = describeEvents(g).map((x) => x.text);
  assert.match(lines[0], /Hawks #4 A0 \+2 \(2-pt\) → 2–0/);
  assert.match(lines[1], /Lions #4 B0 \+3 \(3-pt\) → 2–3/);
});

test('isGame rejects files that are not scoresheets', () => {
  assert.equal(isGame(newGame()), true);
  assert.equal(isGame({}), false);
  assert.equal(isGame(null), false);
  assert.equal(isGame({ events: [], info: {}, teams: { A: {}, B: {} } }), false);
});
