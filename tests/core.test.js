'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

function makeTournament(n, settings) {
  const t = C.createTournament('Test');
  Object.assign(t.settings, settings || {});
  t.settings = C.normalizeSettings(t.settings);
  for (let i = 0; i < n; i++) t.teams.push({ id: 'T' + i, name: 'Team ' + i, group: null });
  return t;
}

test('roundRobin: jedes Paar genau einmal, niemand doppelt pro Runde', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const ids = Array.from({ length: n }, (_, i) => 'T' + i);
    const rounds = C.roundRobin(ids, 1);
    const seen = new Set();
    for (const round of rounds) {
      const inRound = new Set();
      for (const [a, b] of round) {
        assert.ok(!inRound.has(a) && !inRound.has(b), `n=${n}: Team doppelt in Runde`);
        inRound.add(a);
        inRound.add(b);
        const key = [a, b].sort().join('-');
        assert.ok(!seen.has(key), `n=${n}: Paarung doppelt`);
        seen.add(key);
      }
    }
    assert.equal(seen.size, (n * (n - 1)) / 2);
  }
});

test('roundRobin: Hin- und Rückspiel tauscht Heimrecht', () => {
  const rounds = C.roundRobin(['A', 'B', 'C', 'D'], 2);
  const games = rounds.flat().map(([a, b]) => a + b);
  assert.equal(games.length, 12);
  assert.equal(new Set(games).size, 12);
});

test('seedOrder', () => {
  assert.deepEqual(C.seedOrder(2), [1, 2]);
  assert.deepEqual(C.seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(C.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('Spielplan: Feldgrenze und kein Team doppelt im selben Slot', () => {
  const t = makeTournament(10, { groupCount: 2, fields: 3, minRest: 1 });
  C.startTournament(t);
  const bySlot = new Map();
  for (const m of t.matches) {
    const list = bySlot.get(m.slot) || [];
    list.push(m);
    bySlot.set(m.slot, list);
  }
  for (const list of bySlot.values()) {
    assert.ok(list.length <= 3);
    const teams = list.flatMap((m) => [m.home, m.away]);
    assert.equal(new Set(teams).size, teams.length);
  }
  // Mindestpause 1: kein Team in zwei direkt aufeinanderfolgenden Slots
  for (const team of t.teams) {
    const slots = t.matches.filter((m) => m.home === team.id || m.away === team.id).map((m) => m.slot).sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++) assert.ok(slots[i] - slots[i - 1] >= 2);
  }
  assert.equal(t.matches.length, 20);
});

test('Tabelle: Direktvergleich entscheidet bei Punktgleichheit', () => {
  const s = C.normalizeSettings({ tiebreakers: ['points', 'h2h', 'diff'] });
  const matches = [
    { home: 'A', away: 'B', scoreH: 1, scoreA: 0 },
    { home: 'A', away: 'C', scoreH: 0, scoreA: 5 },
    { home: 'B', away: 'C', scoreH: 1, scoreA: 0 },
  ];
  // alle 3 Punkte; Direktvergleich im Dreieck gleich → weiter mit Differenz: C +4, B 0, A -4
  const table = C.computeTable(['A', 'B', 'C'], matches, s);
  assert.deepEqual(table.map((r) => r.id), ['C', 'B', 'A']);
  assert.ok(table.every((r) => !r.tied));
});

test('Tabelle: nicht auflösbarer Gleichstand teilt den Rang', () => {
  const s = C.normalizeSettings({});
  const matches = [{ home: 'A', away: 'B', scoreH: 2, scoreA: 2 }];
  const table = C.computeTable(['A', 'B', 'C'], matches, s);
  assert.equal(table[0].rank, 1);
  assert.equal(table[1].rank, 1);
  assert.equal(table[2].rank, 3);
});

test('KO mit 6 Teams: 2 Freilose, Final und Spiel um Platz 3', () => {
  const t = makeTournament(6, { format: 'ko', thirdPlace: true });
  C.startTournament(t);
  const ko = t.matches;
  assert.equal(ko.filter((m) => m.round === 0).length, 2);
  assert.equal(ko.filter((m) => m.round === 1).length, 2);
  assert.ok(ko.some((m) => m.thirdPlace));
  // alles durchspielen: Heimteam gewinnt
  for (let guard = 0; guard < 10; guard++) {
    const open = t.matches.find((m) => m.home && m.away && !C.isPlayed(m));
    if (!open) break;
    C.setResult(t, open.id, 2, 1);
  }
  const ranking = C.finalRanking(t);
  assert.ok(ranking);
  assert.equal(ranking[0].place, 1);
  // Plätze 1–4 ausgespielt, die beiden Viertelfinal-Verlierer teilen Platz 5
  assert.deepEqual(ranking.map((r) => r.place), [1, 2, 3, 4, 5]);
  assert.equal(ranking[4].teams.length, 2);
  assert.ok(C.isFinished(t));
});

test('KO: Remis braucht einen gewählten Sieger', () => {
  const t = makeTournament(2, { format: 'ko' });
  C.startTournament(t);
  const final = t.matches[0];
  C.setResult(t, final.id, 1, 1);
  assert.equal(C.matchWinner(final), null);
  C.setResult(t, final.id, 1, 1, final.away);
  assert.equal(C.matchWinner(final), final.away);
});

test('KO: geändertes Resultat löscht abhängige Spiele', () => {
  const t = makeTournament(4, { format: 'ko', thirdPlace: true });
  C.startTournament(t);
  const [s1, s2] = t.matches.filter((m) => m.round === 0);
  C.setResult(t, s1.id, 3, 0);
  C.setResult(t, s2.id, 3, 0);
  const final = t.matches.find((m) => m.round === 1 && !m.thirdPlace);
  C.setResult(t, final.id, 1, 0);
  assert.ok(C.isPlayed(final));
  C.setResult(t, s1.id, 0, 3); // anderer Sieger
  assert.ok(!C.isPlayed(final), 'Final-Resultat muss gelöscht sein');
  assert.equal(final.home, s1.away);
});

test('Gruppen + KO: Gruppengegner treffen sich nicht in Runde 1', () => {
  const t = makeTournament(16, { format: 'groups_ko', groupCount: 4, advancePerGroup: 2 });
  C.drawGroups(t, mulberry(7));
  C.startTournament(t);
  const rng = mulberry(3);
  for (const m of t.matches) C.setResult(t, m.id, Math.floor(rng() * 5), Math.floor(rng() * 5));
  C.startKO(t);
  const groupOf = new Map(t.teams.map((x) => [x.id, x.group]));
  const first = t.matches.filter((m) => m.phase === 'ko' && m.round === 0);
  assert.equal(first.length, 4);
  for (const m of first) assert.notEqual(groupOf.get(m.home), groupOf.get(m.away));
  // KO beginnt nach der Gruppenphase
  const groupEnd = Math.max(...t.matches.filter((m) => m.phase === 'group').map((m) => m.start));
  assert.ok(first.every((m) => m.start > groupEnd));
});

test('Gruppen + KO: beste Dritte und Freilose (3 Gruppen)', () => {
  const t = makeTournament(9, { format: 'groups_ko', groupCount: 3, advancePerGroup: 2, extraQualifiers: 2 });
  C.drawGroups(t, mulberry(11));
  C.startTournament(t);
  for (const m of t.matches) C.setResult(t, m.id, 1, 0);
  C.startKO(t);
  const entries = t.matches.filter((m) => m.phase === 'ko');
  assert.equal(entries.filter((m) => m.round === 0).length, 4); // 8 Teams → Viertelfinal
});

test('Gruppenresultate sind nach KO-Start gesperrt', () => {
  const t = makeTournament(4, { format: 'groups_ko', groupCount: 1, advancePerGroup: 2 });
  C.startTournament(t);
  for (const m of t.matches) C.setResult(t, m.id, 1, 0);
  C.startKO(t);
  const g = t.matches.find((m) => m.phase === 'group');
  assert.throws(() => C.setResult(t, g.id, 0, 0));
});

test('Validierung meldet zu kleine Gruppen', () => {
  const t = makeTournament(3, { groupCount: 2 });
  const errors = C.validateSetup(t);
  assert.ok(errors.some((e) => e.includes('mindestens 2 Teams')));
});

test('normalizeTournament verwirft Unsinn', () => {
  const t = C.normalizeTournament({ name: 'X', settings: { fields: 'abc', groupCount: 999 }, teams: [{ id: 'a', name: '<b>' }, { id: 'a', name: 'dup' }] });
  assert.equal(t.settings.fields, 2);
  assert.equal(t.settings.groupCount, 26);
  assert.equal(t.teams.length, 1);
});

test('Liga (1 Gruppe): Schlussrangliste nach allen Spielen', () => {
  const t = makeTournament(5, { format: 'groups', groupCount: 1 });
  C.startTournament(t);
  assert.equal(t.matches.length, 10);
  for (const m of t.matches) C.setResult(t, m.id, 1, 0);
  assert.ok(C.isFinished(t));
  assert.equal(C.finalRanking(t).length, 5);
});

function playAll(t, rng) {
  for (let guard = 0; guard < 500; guard++) {
    const open = t.matches.find((m) => m.home && m.away && !C.isPlayed(m));
    if (!open) return;
    const h = rng ? Math.floor(rng() * 4) : 2;
    let a = rng ? Math.floor(rng() * 4) : 1;
    if (open.phase === 'ko' && a === h) a = h + 1;
    C.setResult(t, open.id, h, a);
  }
}

function placesOf(t) {
  return C.finalRanking(t).flatMap((r) => r.teams.map(() => r.place));
}

test('Alle Plätze ausspielen: KO mit 8 und 6 Teams', () => {
  const t8 = makeTournament(8, { format: 'ko', placements: true });
  C.startTournament(t8);
  assert.equal(t8.matches.length, 12);
  playAll(t8);
  assert.deepEqual(placesOf(t8), [1, 2, 3, 4, 5, 6, 7, 8]);
  const t6 = makeTournament(6, { format: 'ko', placements: true });
  C.startTournament(t6);
  playAll(t6);
  assert.deepEqual(placesOf(t6), [1, 2, 3, 4, 5, 6]);
  assert.ok(C.isFinished(t6));
});

test('Alle Plätze ausspielen: Gruppen + KO inkl. Nichtqualifizierte', () => {
  const t = makeTournament(10, { format: 'groups_ko', groupCount: 2, advancePerGroup: 2, placements: true });
  C.drawGroups(t, mulberry(5));
  C.startTournament(t);
  playAll(t, mulberry(9));
  C.startFinals(t);
  playAll(t, mulberry(10));
  assert.deepEqual(placesOf(t), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(C.finalRanking(t).flatMap((r) => r.teams)).size, 10);
});

test('Platzierungsspiele nach Gruppenphase (2 Gruppen à 4)', () => {
  const t = makeTournament(8, { format: 'groups', groupCount: 2, placements: true });
  C.drawGroups(t, mulberry(2));
  C.startTournament(t);
  playAll(t, mulberry(4));
  C.startFinals(t);
  const ko = t.matches.filter((m) => m.phase === 'ko');
  assert.equal(ko.length, 4);
  assert.deepEqual(ko.map((m) => m.label).sort(), ['Final', 'Spiel um Platz 3', 'Spiel um Platz 5', 'Spiel um Platz 7']);
  // Final kommt zuletzt
  assert.equal(ko.sort((a, b) => a.order - b.order)[3].label, 'Final');
  playAll(t);
  assert.deepEqual(placesOf(t), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('Mittagspause verschiebt spätere Spiele', () => {
  const t = makeTournament(6, { groupCount: 1, fields: 1, startTime: '11:00', matchDuration: 10, breakDuration: 5, lunchStart: '12:00', lunchDuration: 30 });
  C.startTournament(t);
  const starts = [...new Set(t.matches.map((m) => m.start))].sort((a, b) => a - b).map(C.formatTime);
  // 11:00, 11:15, 11:30, 11:45 (endet 11:55), 12:00 würde in die Pause fallen → 12:30
  assert.deepEqual(starts.slice(0, 6), ['11:00', '11:15', '11:30', '11:45', '12:30', '12:45']);
});

test('Losentscheid löst Gleichstand auf', () => {
  const t = makeTournament(2, { groupCount: 1 });
  C.startTournament(t);
  C.setResult(t, t.matches[0].id, 1, 1);
  let table = C.groupTables(t)[0];
  assert.ok(table[0].tied);
  C.drawLots(t, ['T0', 'T1'], mulberry(1));
  table = C.groupTables(t)[0];
  assert.ok(!table[0].tied && table[0].byLot);
  assert.deepEqual(table.map((r) => r.rank), [1, 2]);
});

test('Spieluhr: Halbzeit, Spielende, Wechselpause, nächstes Spiel', () => {
  const t = makeTournament(4, { groupCount: 1, fields: 1, matchDuration: 10, breakDuration: 2, timerHalves: 2 });
  C.startTournament(t);
  const first = t.matches.slice().sort((a, b) => a.start - b.start)[0];
  t.timer = C.createTimer(t, first.id, 'me');
  C.timerStart(t.timer, 0);
  assert.deepEqual(C.timerTick(t, 4 * 60000), []);
  assert.deepEqual(C.timerTick(t, 5 * 60000 + 300), ['halftime']);
  assert.equal(C.timerPhaseLabel(t, 5 * 60000 + 400), 'Halbzeit · Seitenwechsel');
  C.timerStart(t.timer, 6 * 60000);
  assert.equal(C.formatClock(C.timerRemaining(t.timer, 7 * 60000)), '04:00');
  assert.deepEqual(C.timerTick(t, 11 * 60000), ['end']);
  assert.equal(t.timer.phase, 'break');
  assert.deepEqual(C.timerTick(t, 13 * 60000 + 10), ['break-end']);
  assert.notEqual(t.timer.matchId, first.id);
  assert.equal(t.timer.running, false);
});

function mulberry(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
