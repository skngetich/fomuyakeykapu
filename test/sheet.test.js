// The printed sheet, checked as SVG markup: what lands in which box. Rendering
// is a pure function of the game, so no browser is needed. Marks carry data-*
// attributes so the tests can find them without depending on coordinates.
import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, newPlayer, uid } from '../app/model.js';
import { renderSheet } from '../app/sheet.js';

function game() {
  const g = newGame();
  g.teams.A.name = 'Hawks';
  g.teams.B.name = 'Lions';
  Object.assign(g.teams.A.players[0], { no: '7', name: 'Ada', starter: true });
  Object.assign(g.teams.A.players[1], { no: '9', name: 'Bea' });
  return g;
}
const add = (g, ev) => g.events.push({ id: uid(), at: 0, period: 1, ...ev });
const shooter = (g, i = 0) => g.teams.A.players[i].id;

/** The <g data-attr="value"> group, or undefined. */
const group = (svg, attr, value) =>
  svg.match(new RegExp(`<g data-${attr}="${value}"[^>]*>(.*?)</g>`, 's'))?.[0];
const texts = (s) => [...s.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

test('the sheet is one A4 page drawn in millimetres', () => {
  const svg = renderSheet(game());
  assert.match(svg, /^<svg [^>]*viewBox="0 0 210 297"[^>]*width="210mm" height="297mm"/);
});

test('the heading is the league name, with no FIBA wording by default', () => {
  const g = game();
  assert.doesNotMatch(renderSheet(g), /FEDERATION|FIBA/i);
  assert.equal(group(renderSheet(g), 'heading', '1'), undefined);
  g.info.heading = 'Riverside <Summer> League';
  assert.deepEqual(texts(group(renderSheet(g), 'heading', '1')), ['Riverside &lt;Summer&gt; League']);
});

test('running score: field goals struck with the shooter, threes circled, free throws circled', () => {
  const g = game();
  add(g, { t: 'score', team: 'A', player: shooter(g), pts: 2 });
  add(g, { t: 'score', team: 'A', player: shooter(g), pts: 1 });
  add(g, { t: 'score', team: 'A', player: shooter(g), pts: 3 });
  const svg = renderSheet(g);
  const two = group(svg, 'rs', 'A2');
  assert.match(two, /data-mark="fg"/);
  assert.deepEqual(texts(two), ['2', '7']);
  assert.match(two, /<line /, 'the total is struck through');
  const ft = group(svg, 'rs', 'A3');
  assert.match(ft, /data-mark="ft"/);
  assert.deepEqual(texts(ft), ['3'], 'a free throw carries no number');
  assert.match(ft, /<circle /);
  const three = group(svg, 'rs', 'A6');
  assert.match(three, /data-mark="three"/);
  assert.deepEqual(texts(three), ['6', '7']);
  assert.match(three, /<circle /, "the shooter's number is circled");
});

test('the end of a period is ruled and the final total boxed', () => {
  const g = game();
  add(g, { t: 'score', team: 'A', player: shooter(g), pts: 2 });
  add(g, { t: 'endPeriod', team: 'A' });
  add(g, { t: 'score', team: 'A', player: shooter(g), pts: 2 });
  add(g, { t: 'endPeriod', team: 'A' });
  add(g, { t: 'endGame', team: 'A' });
  const svg = renderSheet(g);
  assert.match(group(svg, 'rs', 'A2'), /data-end="q"/);
  assert.match(group(svg, 'rs', 'A4'), /data-end="fin"/);
  assert.deepEqual(texts(group(svg, 'final', '1')), ['Final score', 'A', '4', 'B', '0']);
  assert.ok(texts(group(svg, 'winner', '1')).includes('Hawks'));
});

test('time-outs show the minute, or a cross when none was given, in the right half', () => {
  const g = game();
  add(g, { t: 'timeout', team: 'A', minute: '7' });
  add(g, { t: 'endPeriod', team: 'A' });
  add(g, { t: 'endPeriod', team: 'A' });
  add(g, { t: 'timeout', team: 'A', minute: '' });
  const svg = renderSheet(g);
  assert.deepEqual(texts(group(svg, 'timeout', '0')), ['7'], 'first half');
  const second = group(svg, 'timeout', '1');
  assert.deepEqual(texts(second), [], 'second half, no minute');
  assert.equal([...second.matchAll(/<line /g)].length, 2, 'a cross');
});

test('team fouls strike through one number per foul', () => {
  const g = game();
  for (let i = 0; i < 3; i++) add(g, { t: 'foul', who: 'player', team: 'A', player: shooter(g), type: 'P', ft: 0 });
  const svg = renderSheet(g);
  assert.equal([...svg.matchAll(/<g data-teamfoul="1">/g)].length, 3);
  assert.equal([...svg.matchAll(/<g data-teamfoul="2">/g)].length, 0);
});

test('fouls fill the player row and fouling out strikes the number', () => {
  const g = game();
  for (const type of ['P', 'P', 'T', 'P', 'P']) add(g, { t: 'foul', who: 'player', team: 'A', player: shooter(g), type, ft: 0 });
  const row = group(renderSheet(g), 'player', 'A0');
  assert.match(row, /data-out="1"/);
  assert.deepEqual(texts(row), ['Ada', '7', 'P', 'P', 'T', 'P', 'P']);
});

test('player in: an X for anyone who played, circled for a starter', () => {
  const g = game();
  add(g, { t: 'score', team: 'A', player: shooter(g, 1), pts: 2 });
  const svg = renderSheet(g);
  const starter = group(svg, 'player', 'A0');
  const sub = group(svg, 'player', 'A1');
  assert.match(starter, /<circle /);
  assert.equal([...sub.matchAll(/<line /g)].length, 2, 'the X');
  assert.doesNotMatch(sub, /<circle /);
});

test('officials are printed beside a blank line to sign on', () => {
  const g = game();
  g.officials.scorekeeper = 'C. Diaz';
  g.info.referee = 'A. Mensah';
  const svg = renderSheet(g);
  const scorer = group(svg, 'sign', 'Scorekeeper');
  assert.deepEqual(texts(scorer), ['Scorekeeper', 'C. Diaz']);
  assert.match(scorer, /<line /);
  assert.deepEqual(texts(group(svg, 'sign', 'Referee')), ['Referee', 'A. Mensah']);
});

test('a protest is noted on the sheet only when there is one', () => {
  const g = game();
  assert.equal(group(renderSheet(g), 'protest', '1'), undefined);
  g.protest = 'Lions: clock error in Q4';
  assert.deepEqual(texts(group(renderSheet(g), 'protest', '1')), ['Protest: Lions: clock error in Q4']);
});

test('more than twelve players still fit on the one page', () => {
  const g = game();
  for (let i = 0; i < 4; i++) g.teams.A.players.push(Object.assign(newPlayer(), { no: String(20 + i), name: `Extra ${i}` }));
  const svg = renderSheet(g);
  assert.ok(group(svg, 'player', 'A15'), 'the sixteenth row is drawn');
  const ys = [...svg.matchAll(/ y="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...ys) <= 297, 'nothing is drawn below the page');
});

test('long names are shortened rather than running off their line', () => {
  const g = game();
  g.teams.A.players[0].name = 'Alexandria Konstantinopoulou-Vanderbilt the Third';
  const [name] = texts(group(renderSheet(g), 'player', 'A0'));
  assert.ok(name.endsWith('…') && name.length < 40);
});

test('names and fields are escaped on the printed sheet', () => {
  const g = game();
  g.teams.A.players[0].name = '<img src=x onerror=alert(1)>';
  g.info.place = '"><script>';
  const svg = renderSheet(g);
  assert.doesNotMatch(svg, /<img|<script/);
});
