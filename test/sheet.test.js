// The printed sheet, checked as markup: what lands in which box. Rendering is a
// pure function of the game, so no browser is needed.
import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, uid } from '../app/model.js';
import { renderSheet } from '../app/sheet.js';

function game() {
  const g = newGame();
  g.teams.A.name = 'Hawks';
  g.teams.B.name = 'Lions';
  g.teams.A.players[0].no = '7';
  g.teams.A.players[0].name = 'Ada';
  g.teams.A.players[0].starter = true;
  return g;
}
const add = (g, ev) => g.events.push({ id: uid(), at: 0, period: 1, ...ev });
const shooter = (g) => g.teams.A.players[0].id;

/** The running-score cell for total n in team A's column. */
const cell = (html, n) => html.match(new RegExp(`<td class="([^"]*)"><b>${n}</b>(.*?)</td>`))?.slice(1);

test('the heading is the league name, with no FIBA wording by default', () => {
  const g = game();
  assert.doesNotMatch(renderSheet(g), /FEDERATION|FIBA/i);
  g.info.heading = 'Riverside <Summer> League';
  assert.match(renderSheet(g), /<div class="fed">Riverside &lt;Summer&gt; League<\/div>/);
});

test('running score: field goals are struck with the shooter, free throws circled', () => {
  const g = game();
  add(g, { t: 'score', team: 'A', player: shooter(g), pts: 2 });
  add(g, { t: 'score', team: 'A', player: shooter(g), pts: 1 });
  add(g, { t: 'score', team: 'A', player: shooter(g), pts: 3 });
  const html = renderSheet(g);
  assert.deepEqual(cell(html, 2), ['rs fg', '<i class="">7</i>']);
  assert.deepEqual(cell(html, 3), ['rs ft', ''], 'a free throw carries no number');
  assert.deepEqual(cell(html, 6), ['rs fg', '<i class="three">7</i>'], 'a three has its number circled');
});

test('the end of a period is ruled and the final total boxed', () => {
  const g = game();
  add(g, { t: 'score', team: 'A', player: shooter(g), pts: 2 });
  add(g, { t: 'endPeriod', team: 'A' });
  add(g, { t: 'score', team: 'A', player: shooter(g), pts: 2 });
  add(g, { t: 'endPeriod', team: 'A' });
  add(g, { t: 'endGame', team: 'A' });
  const html = renderSheet(g);
  assert.equal(cell(html, 2)[0], 'rs fg eop');
  assert.equal(cell(html, 4)[0], 'rs fg fin');
  assert.match(html, /Name of winning team <span class="fill" style="min-width:48mm">Hawks<\/span>/);
});

test('fouls fill the player row and fouling out strikes the number', () => {
  const g = game();
  for (const type of ['P', 'P', 'T', 'P', 'P']) add(g, { t: 'foul', who: 'player', team: 'A', player: shooter(g), type, ft: 0 });
  const row = renderSheet(g).match(/<tr class=" out">([\s\S]*?)<\/tr>/)?.[1];
  assert.ok(row, 'the row is marked out');
  assert.equal([...row.matchAll(/class="fcell has"/g)].length, 5);
  assert.match(row, />T1?</);
});

test('names and fields are escaped on the printed sheet', () => {
  const g = game();
  g.teams.A.players[0].name = '<img src=x onerror=alert(1)>';
  g.info.place = '"><script>';
  const html = renderSheet(g);
  assert.doesNotMatch(html, /<img|<script/);
});
