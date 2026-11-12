/*
 * TournamentBuilder – Kernlogik
 * Enthält keine DOM-Zugriffe und läuft deshalb im Browser und in Node (Tests).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TBCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Grundlagen                                                          */
  /* ------------------------------------------------------------------ */

  const FORMATS = {
    groups: 'Nur Gruppenphase / Liga (jeder gegen jeden)',
    groups_ko: 'Gruppenphase + KO-Phase',
    ko: 'Nur KO-System',
  };

  const TIEBREAKERS = {
    points: 'Punkte',
    diff: 'Tordifferenz',
    scored: 'Erzielte Tore',
    wins: 'Anzahl Siege',
    h2h: 'Direktvergleich',
  };

  const DEFAULT_SETTINGS = Object.freeze({
    format: 'groups_ko',
    groupCount: 2,
    legs: 1,
    advancePerGroup: 2,
    extraQualifiers: 0,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    tiebreakers: Object.freeze(['points', 'diff', 'scored', 'h2h']),
    thirdPlace: true,
    fields: 2,
    startTime: '09:00',
    matchDuration: 10,
    breakDuration: 2,
    minRest: 0,
    koBreak: 10,
    koMatchDuration: 10,
    scoreUnit: 'Tore',
    fieldName: 'Feld',
    placements: false,
    lunchStart: '',
    lunchDuration: 45,
    timerHalves: 1,
    shiftInterval: 0,
  });

  // Einstellungen, die den Zeitplan beeinflussen (dürfen auch während des Turniers geändert werden)
  const SCHEDULE_KEYS = [
    'fields',
    'startTime',
    'matchDuration',
    'breakDuration',
    'minRest',
    'koBreak',
    'koMatchDuration',
    'lunchStart',
    'lunchDuration',
  ];

  let uidCounter = 0;
  function uid(prefix) {
    uidCounter = (uidCounter + 1) % 1679616;
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + uidCounter.toString(36);
  }

  function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function shuffle(list, rng) {
    const random = rng || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function groupLetter(i) {
    return String.fromCharCode(65 + i);
  }

  function groupName(i) {
    return 'Gruppe ' + groupLetter(i);
  }

  function parseTime(str) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(str || '');
    if (!m) return 9 * 60;
    return Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]);
  }

  function formatTime(minutes) {
    const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function isPlayed(m) {
    return Number.isInteger(m.scoreH) && Number.isInteger(m.scoreA);
  }

  /* ------------------------------------------------------------------ */
  /* Turnier anlegen / normalisieren                                     */
  /* ------------------------------------------------------------------ */

  function normalizeSettings(raw) {
    const s = raw || {};
    const d = DEFAULT_SETTINGS;
    let tb = Array.isArray(s.tiebreakers) ? s.tiebreakers.filter((k) => k in TIEBREAKERS) : d.tiebreakers.slice();
    tb = Array.from(new Set(tb));
    if (!tb.length) tb = d.tiebreakers.slice();
    const text = (v, fallback, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);
    return {
      format: Object.prototype.hasOwnProperty.call(FORMATS, s.format) ? s.format : d.format,
      groupCount: clampInt(s.groupCount, 1, 26, d.groupCount),
      legs: clampInt(s.legs, 1, 2, d.legs),
      advancePerGroup: clampInt(s.advancePerGroup, 1, 32, d.advancePerGroup),
      extraQualifiers: clampInt(s.extraQualifiers, 0, 26, d.extraQualifiers),
      pointsWin: clampInt(s.pointsWin, 0, 10, d.pointsWin),
      pointsDraw: clampInt(s.pointsDraw, 0, 10, d.pointsDraw),
      pointsLoss: clampInt(s.pointsLoss, 0, 10, d.pointsLoss),
      tiebreakers: tb,
      thirdPlace: s.thirdPlace === undefined ? d.thirdPlace : !!s.thirdPlace,
      fields: clampInt(s.fields, 1, 50, d.fields),
      startTime: /^\d{1,2}:\d{2}$/.test(s.startTime || '') ? s.startTime : d.startTime,
      matchDuration: clampInt(s.matchDuration, 1, 300, d.matchDuration),
      breakDuration: clampInt(s.breakDuration, 0, 120, d.breakDuration),
      minRest: clampInt(s.minRest, 0, 10, d.minRest),
      koBreak: clampInt(s.koBreak, 0, 600, d.koBreak),
      koMatchDuration: clampInt(s.koMatchDuration, 1, 300, d.koMatchDuration),
      scoreUnit: text(s.scoreUnit, d.scoreUnit, 20),
      fieldName: text(s.fieldName, d.fieldName, 20),
      placements: s.placements === undefined ? d.placements : !!s.placements,
      lunchStart: /^\d{1,2}:\d{2}$/.test(s.lunchStart || '') ? s.lunchStart : '',
      lunchDuration: clampInt(s.lunchDuration, 0, 300, d.lunchDuration),
      timerHalves: clampInt(s.timerHalves, 1, 2, d.timerHalves),
      shiftInterval: clampInt(s.shiftInterval, 0, 60, d.shiftInterval),
    };
  }

  function createTournament(name) {
    return {
      id: uid('t'),
      version: 1,
      name: (typeof name === 'string' && name.trim() ? name.trim() : 'Neues Turnier').slice(0, 80),
      created: Date.now(),
      settings: normalizeSettings({}),
      teams: [],
      stage: 'setup', // setup | groups | ko (KO- bzw. Platzierungsrunde)
      matches: [],
      places: [], // Schlussränge: [{place, srcs:[{team}|{winner}|{loser}]}]
      lots: {}, // Losentscheid: teamId -> Zufallszahl
      timer: null,
      live: false,
    };
  }

  function normalizeTournament(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Ungültige Turnierdatei.');
    const t = createTournament(raw.name);
    if (typeof raw.id === 'string' && raw.id) t.id = raw.id;
    if (Number.isFinite(raw.created)) t.created = raw.created;
    t.settings = normalizeSettings(raw.settings);
    const seen = new Set();
    t.teams = (Array.isArray(raw.teams) ? raw.teams : [])
      .filter((x) => x && typeof x.id === 'string' && !seen.has(x.id) && seen.add(x.id))
      .map((x) => ({
        id: x.id,
        name: String(x.name || 'Team').trim().slice(0, 60) || 'Team',
        group: Number.isInteger(x.group) && x.group >= 0 ? x.group : null,
      }));
    t.matches = (Array.isArray(raw.matches) ? raw.matches : []).filter((m) => m && typeof m.id === 'string');
    t.stage = ['setup', 'groups', 'ko'].includes(raw.stage) ? raw.stage : 'setup';
    t.places = Array.isArray(raw.places) ? raw.places.filter((p) => p && Number.isInteger(p.place) && Array.isArray(p.srcs)) : [];
    t.lots = {};
    if (raw.lots && typeof raw.lots === 'object') {
      for (const [k, v] of Object.entries(raw.lots)) if (Number.isFinite(v)) t.lots[k] = v;
    }
    t.timer = raw.timer && typeof raw.timer === 'object' && typeof raw.timer.matchId === 'string' ? raw.timer : null;
    t.live = !!raw.live;
    if (t.stage === 'setup') {
      t.matches = [];
      t.places = [];
      t.timer = null;
    }
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* Teams & Gruppen                                                     */
  /* ------------------------------------------------------------------ */

  function usesGroups(s) {
    return s.format !== 'ko';
  }

  /** Gibt es eine KO- bzw. Platzierungsrunde? */
  function usesKO(s) {
    return s.format === 'ko' || hasFinals(s);
  }

  function teamsByGroup(t) {
    const groups = Array.from({ length: t.settings.groupCount }, () => []);
    for (const team of t.teams) {
      if (t.settings.groupCount === 1) groups[0].push(team.id);
      else if (Number.isInteger(team.group) && team.group < groups.length) groups[team.group].push(team.id);
    }
    return groups;
  }

  /** Teams ohne (gültige) Gruppe der jeweils kleinsten Gruppe zuteilen. */
  function fillUnassigned(t) {
    const n = t.settings.groupCount;
    const sizes = new Array(n).fill(0);
    for (const team of t.teams) {
      if (Number.isInteger(team.group) && team.group < n) sizes[team.group]++;
    }
    for (const team of t.teams) {
      if (!(Number.isInteger(team.group) && team.group < n)) {
        const g = sizes.indexOf(Math.min(...sizes));
        team.group = g;
        sizes[g]++;
      }
    }
  }

  /** Alle Teams zufällig und gleichmässig auf die Gruppen verteilen. */
  function drawGroups(t, rng) {
    const n = t.settings.groupCount;
    shuffle(t.teams, rng).forEach((team, i) => {
      team.group = i % n;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Spielplan                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Jeder gegen jeden nach der Kreismethode (Berger-Tabellen).
   * Liefert ein Array von Runden; jede Runde enthält Paarungen [heim, gast].
   * In jeder Runde spielt jedes Team höchstens einmal.
   */
  function roundRobin(teamIds, legs) {
    const list = teamIds.slice();
    if (list.length < 2) return [];
    if (list.length % 2) list.push(null); // spielfrei
    const n = list.length;
    let arr = list;
    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const pairs = [];
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i];
        const b = arr[n - 1 - i];
        if (a === null || b === null) continue;
        // Heim/Gast abwechseln, damit niemand immer "Heim" ist
        const flip = i === 0 ? r % 2 === 1 : i % 2 === 1;
        pairs.push(flip ? [b, a] : [a, b]);
      }
      rounds.push(pairs);
      arr = [arr[0], arr[n - 1]].concat(arr.slice(1, n - 1));
    }
    if (legs === 2) {
      return rounds.concat(rounds.map((pairs) => pairs.map(([a, b]) => [b, a])));
    }
    return rounds;
  }

  function newMatch(props) {
    return Object.assign(
      {
        id: uid('m'),
        phase: 'group',
        group: null,
        round: 0,
        order: 0,
        home: null,
        away: null,
        scoreH: null,
        scoreA: null,
        winner: null,
        resultFor: null,
        slot: 0,
        field: 1,
        start: 0,
      },
      props
    );
  }

  function matchTeamsForScheduling(m) {
    if (m.phase === 'ko') {
      return [m.homeSrc && m.homeSrc.team, m.awaySrc && m.awaySrc.team].filter(Boolean);
    }
    return [m.home, m.away].filter(Boolean);
  }

  /**
   * Verteilt Spiele auf Zeitfenster (Slots) und Felder.
   * - pro Slot höchstens `fields` Spiele
   * - kein Team spielt zweimal im selben Slot
   * - zwischen zwei Spielen eines Teams liegen mindestens `minRest` freie Slots
   * - KO-Spiele starten erst nach den Spielen, von denen sie abhängen
   * Die Reihenfolge der Liste wird so gut wie möglich eingehalten, Lücken werden aufgefüllt.
   */
  function scheduleMatches(matches, opts) {
    const fields = Math.max(1, opts.fields || 1);
    const minRest = Math.max(0, opts.minRest || 0);
    const pending = matches.slice();
    const lastSlot = new Map();
    const slotOf = new Map();
    let slot = 0;
    let emptySlots = 0;
    while (pending.length) {
      const busy = new Set();
      let used = 0;
      for (let i = 0; i < pending.length && used < fields; ) {
        const m = pending[i];
        const teams = matchTeamsForScheduling(m);
        const teamsOk = teams.every(
          (id) => !busy.has(id) && (!lastSlot.has(id) || slot - lastSlot.get(id) > minRest)
        );
        const depsOk = (m.deps || []).every((d) => slotOf.has(d) && slot - slotOf.get(d) > minRest);
        if (teamsOk && depsOk) {
          m.slot = slot;
          m.field = used + 1;
          used++;
          teams.forEach((id) => {
            busy.add(id);
            lastSlot.set(id, slot);
          });
          slotOf.set(m.id, slot);
          pending.splice(i, 1);
        } else {
          i++;
        }
      }
      emptySlots = used ? 0 : emptySlots + 1;
      if (emptySlots > minRest + 2) throw new Error('Spielplan konnte nicht erstellt werden (zyklische Abhängigkeit).');
      slot++;
    }
  }

  function lunchWindow(s) {
    if (!s.lunchStart || !s.lunchDuration) return null;
    const from = parseTime(s.lunchStart);
    return { from, to: from + s.lunchDuration };
  }

  /**
   * Startzeiten für die Slots 0..maxSlot. Ein Slot, der in die Mittagspause
   * fallen würde, beginnt erst nach der Pause; alle späteren Slots rücken nach.
   */
  function slotTimes(base, maxSlot, step, duration, lunch) {
    const times = [];
    let shift = 0;
    let done = !lunch;
    for (let k = 0; k <= maxSlot; k++) {
      let start = base + k * step + shift;
      if (!done) {
        if (start >= lunch.to) done = true;
        else if (start + duration > lunch.from) {
          shift += lunch.to - start;
          start = lunch.to;
          done = true;
        }
      }
      times.push(start);
    }
    return times;
  }

  function applyTimes(t) {
    const s = t.settings;
    const base = parseTime(s.startTime);
    const lunch = lunchWindow(s);
    const group = t.matches.filter((m) => m.phase === 'group');
    if (group.length) {
      const times = slotTimes(base, Math.max(...group.map((m) => m.slot)), s.matchDuration + s.breakDuration, s.matchDuration, lunch);
      for (const m of group) m.start = times[m.slot];
    }
    let koBase = base;
    if (group.length) koBase = Math.max(...group.map((m) => m.start + s.matchDuration)) + s.koBreak;
    const ko = t.matches.filter((m) => m.phase === 'ko');
    if (ko.length) {
      const times = slotTimes(koBase, Math.max(...ko.map((m) => m.slot)), s.koMatchDuration + s.breakDuration, s.koMatchDuration, lunch);
      for (const m of ko) m.start = times[m.slot];
    }
  }

  /** Zeitplan neu berechnen (z. B. nach Änderung der Felderzahl). Resultate bleiben erhalten. */
  function scheduleAll(t) {
    const s = t.settings;
    const opts = { fields: s.fields, minRest: s.minRest };
    const byOrder = (a, b) => a.order - b.order;
    scheduleMatches(t.matches.filter((m) => m.phase === 'group').sort(byOrder), opts);
    scheduleMatches(t.matches.filter((m) => m.phase === 'ko').sort(byOrder), opts);
    applyTimes(t);
  }

  function endTime(t) {
    if (!t.matches.length) return null;
    const s = t.settings;
    return Math.max(...t.matches.map((m) => m.start + (m.phase === 'ko' ? s.koMatchDuration : s.matchDuration)));
  }

  /* ------------------------------------------------------------------ */
  /* Validierung & Start                                                 */
  /* ------------------------------------------------------------------ */

  function validateSetup(t) {
    const s = t.settings;
    const errors = [];
    if (t.teams.length < 2) errors.push('Es braucht mindestens 2 Teams.');
    const names = new Set();
    for (const team of t.teams) {
      const key = team.name.trim().toLowerCase();
      if (names.has(key)) errors.push(`Der Teamname «${team.name}» kommt mehrfach vor.`);
      names.add(key);
    }
    if (usesGroups(s) && t.teams.length >= 2) {
      const tmp = clone(t);
      fillUnassigned(tmp);
      const groups = teamsByGroup(tmp);
      groups.forEach((g, i) => {
        if (g.length < 2) errors.push(`${groupName(i)} braucht mindestens 2 Teams (aktuell ${g.length}).`);
      });
      if (s.format === 'groups_ko' && groups.every((g) => g.length >= 2)) {
        const minSize = Math.min(...groups.map((g) => g.length));
        if (s.advancePerGroup > minSize) {
          errors.push(
            `Pro Gruppe sollen ${s.advancePerGroup} Teams weiterkommen, die kleinste Gruppe hat aber nur ${minSize} Teams.`
          );
        }
        const possibleExtra = groups.filter((g) => g.length > s.advancePerGroup).length;
        if (s.extraQualifiers > possibleExtra) {
          errors.push(`Es können höchstens ${possibleExtra} zusätzliche «beste Nächstplatzierte» weiterkommen.`);
        }
        if (s.groupCount * s.advancePerGroup + s.extraQualifiers < 2) {
          errors.push('Für die KO-Phase müssen mindestens 2 Teams weiterkommen.');
        }
      }
    }
    return errors;
  }

  function startTournament(t) {
    const errors = validateSetup(t);
    if (errors.length) throw new Error(errors.join('\n'));
    const s = t.settings;
    t.matches = [];
    t.places = [];
    t.timer = null;
    if (!usesGroups(s)) {
      t.stage = 'ko';
      const finals = buildFinals(t);
      t.matches = finals.matches;
      t.places = finals.places;
    } else {
      fillUnassigned(t);
      const groups = teamsByGroup(t);
      const perGroup = groups.map((g) => roundRobin(g, s.legs));
      const maxRounds = Math.max(...perGroup.map((r) => r.length));
      let order = 0;
      for (let r = 0; r < maxRounds; r++) {
        perGroup.forEach((rounds, gi) => {
          (rounds[r] || []).forEach(([home, away]) => {
            t.matches.push(newMatch({ phase: 'group', group: gi, round: r, order: order++, home, away }));
          });
        });
      }
      t.stage = 'groups';
    }
    scheduleAll(t);
    resolveKO(t);
    return t;
  }

  /** Simuliert den Start, ohne das Turnier zu verändern (für die Vorschau). */
  function previewTournament(t) {
    const errors = validateSetup(t);
    if (errors.length) return { errors };
    const tmp = startTournament(clone(t));
    const groupMatches = tmp.matches.length;
    const groupEnd = endTime(tmp);
    let finalsMatches = 0;
    if (hasFinals(tmp.settings) && tmp.stage === 'groups') {
      startFinals(tmp, { force: true });
      finalsMatches = tmp.matches.filter((m) => m.phase === 'ko').length;
    }
    const slots = new Set(tmp.matches.map((m) => m.phase + m.slot)).size;
    return {
      errors: [],
      matchCount: groupMatches,
      koMatches: finalsMatches,
      slots,
      start: parseTime(tmp.settings.startTime),
      groupEnd,
      end: endTime(tmp),
    };
  }

  function resetTournament(t) {
    t.matches = [];
    t.places = [];
    t.timer = null;
    t.stage = 'setup';
  }

  /* ------------------------------------------------------------------ */
  /* Tabellen                                                            */
  /* ------------------------------------------------------------------ */

  function emptyRow(id) {
    return { id, played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0, diff: 0, points: 0, rank: 0, tied: false, byLot: false };
  }

  function addResult(row, own, other, s) {
    row.played++;
    row.scored += own;
    row.conceded += other;
    row.diff = row.scored - row.conceded;
    if (own > other) {
      row.won++;
      row.points += s.pointsWin;
    } else if (own === other) {
      row.drawn++;
      row.points += s.pointsDraw;
    } else {
      row.lost++;
      row.points += s.pointsLoss;
    }
  }

  function criterionValue(key, row, bucket, ctx) {
    switch (key) {
      case 'points':
        return row.points;
      case 'diff':
        return row.diff;
      case 'scored':
        return row.scored;
      case 'wins':
        return row.won;
      case 'h2h': {
        // Mini-Tabelle nur mit den Spielen unter den punktgleichen Teams
        const ids = new Set(bucket.map((r) => r.id));
        const mini = emptyRow(row.id);
        for (const m of ctx.matches) {
          if (!isPlayed(m) || !ids.has(m.home) || !ids.has(m.away)) continue;
          if (m.home === row.id) addResult(mini, m.scoreH, m.scoreA, ctx.settings);
          else if (m.away === row.id) addResult(mini, m.scoreA, m.scoreH, ctx.settings);
        }
        return mini.points * 10000 + mini.diff * 100 + Math.min(99, mini.scored);
      }
      default:
        return 0;
    }
  }

  function rankRows(rows, criteria, ctx, tieCounter) {
    if (rows.length <= 1) return rows;
    if (!criteria.length) {
      // Losentscheid, falls für alle Beteiligten ein Los gezogen wurde
      const lots = ctx.lots || {};
      if (rows.every((r) => Number.isFinite(lots[r.id])) && new Set(rows.map((r) => lots[r.id])).size === rows.length) {
        rows.forEach((r) => {
          r.byLot = true;
        });
        return rows.slice().sort((a, b) => lots[b.id] - lots[a.id]);
      }
      const tieId = tieCounter.next++;
      rows.forEach((r) => {
        r.tied = true;
        r.tieGroup = tieId;
      });
      return rows;
    }
    const [key, ...rest] = criteria;
    const values = new Map(rows.map((r) => [r.id, criterionValue(key, r, rows, ctx)]));
    const sorted = rows.slice().sort((a, b) => values.get(b.id) - values.get(a.id));
    const out = [];
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j < sorted.length && values.get(sorted[j].id) === values.get(sorted[i].id)) j++;
      const bucket = sorted.slice(i, j);
      out.push(...(bucket.length > 1 ? rankRows(bucket, rest, ctx, tieCounter) : bucket));
      i = j;
    }
    return out;
  }

  function computeTable(teamIds, matches, settings, lots) {
    const rows = new Map(teamIds.map((id) => [id, emptyRow(id)]));
    const relevant = matches.filter((m) => rows.has(m.home) && rows.has(m.away));
    for (const m of relevant) {
      if (!isPlayed(m)) continue;
      addResult(rows.get(m.home), m.scoreH, m.scoreA, settings);
      addResult(rows.get(m.away), m.scoreA, m.scoreH, settings);
    }
    const ranked = rankRows([...rows.values()], settings.tiebreakers, { matches: relevant, settings, lots }, { next: 0 });
    let rank = 0;
    ranked.forEach((r, i) => {
      const prev = ranked[i - 1];
      if (!(prev && r.tied && prev.tied && prev.tieGroup === r.tieGroup)) rank = i + 1;
      r.rank = rank;
    });
    return ranked;
  }

  function groupTables(t) {
    const groups = teamsByGroup(t);
    return groups.map((ids, gi) =>
      computeTable(
        ids,
        t.matches.filter((m) => m.phase === 'group' && m.group === gi),
        t.settings,
        t.lots
      )
    );
  }

  /** Zieht ein Los für die angegebenen Teams (bei nicht auflösbarem Gleichstand). */
  function drawLots(t, ids, rng) {
    const random = rng || Math.random;
    const order = shuffle(ids, random);
    order.forEach((id, i) => {
      t.lots[id] = order.length - i + random() * 0.001;
    });
  }

  function clearLots(t, ids) {
    for (const id of ids) delete t.lots[id];
  }

  /* ------------------------------------------------------------------ */
  /* KO- und Platzierungsrunde                                           */
  /* ------------------------------------------------------------------ */

  /** Setzreihenfolge für ein Feld der Grösse 2^k, z. B. 8 → [1,8,4,5,2,7,3,6]. */
  function seedOrder(size) {
    let order = [1];
    while (order.length < size) {
      const n = order.length * 2;
      order = order.flatMap((s) => [s, n + 1 - s]);
    }
    return order;
  }

  function koRoundName(teamsInRound) {
    if (teamsInRound === 2) return 'Final';
    if (teamsInRound === 4) return 'Halbfinal';
    if (teamsInRound === 8) return 'Viertelfinal';
    if (teamsInRound === 16) return 'Achtelfinal';
    return 'Runde der ' + teamsInRound;
  }

  /** Erstrunden-Duelle von Teams aus derselben Gruppe durch Tauschen vermeiden. */
  function avoidSameGroup(slots) {
    const pairs = slots.length / 2;
    const conflict = (a, b) => a && b && a.group !== null && a.group !== undefined && a.group === b.group;
    for (let p = 0; p < pairs; p++) {
      if (!conflict(slots[2 * p], slots[2 * p + 1])) continue;
      for (let q = 0; q < pairs; q++) {
        if (q === p) continue;
        const a = slots[2 * p];
        const b = slots[2 * p + 1];
        const c = slots[2 * q];
        const d = slots[2 * q + 1];
        if (!c || !d) continue;
        if (!conflict(a, d) && !conflict(c, b)) {
          slots[2 * p + 1] = d;
          slots[2 * q + 1] = b;
          break;
        }
      }
    }
    return slots;
  }

  /** Setzliste [{team, group}] → Startplätze eines Baums (Zweierpotenz, null = Freilos). */
  function seededSources(entries) {
    const n = entries.length;
    if (n === 0) return [];
    if (n === 1) return [{ team: entries[0].team }];
    let size = 2;
    while (size < n) size *= 2;
    return avoidSameGroup(seedOrder(size).map((seed) => (seed <= n ? entries[seed - 1] : null))).map((e) =>
      e ? { team: e.team } : null
    );
  }

  /**
   * Baut rekursiv einen Turnierbaum für die Plätze firstPlace … firstPlace+n-1.
   * Sieger spielen um die vorderen, Verlierer (falls ausgespielt) um die hinteren Plätze.
   * mode.full: alle Plätze ausspielen; mode.thirdPlace: im Hauptbaum Spiel um Platz 3.
   */
  function buildPlayoff(ctx, srcs, firstPlace, round, mode, isMain) {
    const alive = srcs.filter(Boolean);
    if (!alive.length) return;
    if (alive.length === 1) {
      ctx.places.push({ place: firstPlace, srcs: [alive[0]] });
      return;
    }
    const size = srcs.length;
    const lastPlace = firstPlace + alive.length - 1;
    let roundName;
    if (isMain) roundName = koRoundName(size);
    else if (alive.length === 2) roundName = 'Spiel um Platz ' + firstPlace;
    else roundName = `Platz ${firstPlace}–${lastPlace}: ${koRoundName(size)}`;

    const winners = [];
    const losers = [];
    const roundMatches = [];
    for (let i = 0; i < size; i += 2) {
      const a = srcs[i];
      const b = srcs[i + 1];
      if (a && b) {
        const deps = [a.winner || a.loser, b.winner || b.loser].filter(Boolean);
        const m = newMatch({
          phase: 'ko',
          round,
          homeSrc: a,
          awaySrc: b,
          deps,
          bracket: firstPlace,
          bracketTitle: isMain ? 'KO-Phase' : alive.length === 2 ? 'Spiel um Platz ' + firstPlace : `Platz ${firstPlace}–${lastPlace}`,
          roundName,
          thirdPlace: !isMain && firstPlace === 3 && alive.length === 2,
        });
        roundMatches.push(m);
        winners.push({ winner: m.id });
        losers.push({ loser: m.id });
      } else {
        winners.push(a || b);
        losers.push(null);
      }
    }
    roundMatches.forEach((m, i) => {
      m.label = roundMatches.length > 1 ? `${roundName} ${i + 1}` : roundName;
      ctx.matches.push(m);
    });

    const winnerCount = winners.filter(Boolean).length;
    buildPlayoff(ctx, winners, firstPlace, round + 1, mode, isMain);
    const loserList = losers.filter(Boolean);
    if (!loserList.length) return;
    const playLosers = mode.full || (isMain && mode.thirdPlace && size === 4);
    if (playLosers) buildPlayoff(ctx, losers, firstPlace + winnerCount, round + 1, mode, false);
    else ctx.places.push({ place: firstPlace + winnerCount, srcs: loserList });
  }

  /** Klassischer KO-Baum (für Tests und einfache Aufrufe). */
  function buildBracket(entries, opts) {
    if (entries.length < 2) throw new Error('Für die KO-Phase braucht es mindestens 2 Teams.');
    const ctx = { matches: [], places: [] };
    buildPlayoff(ctx, seededSources(entries), 1, 0, { full: !!(opts && opts.full), thirdPlace: !!(opts && opts.thirdPlace) }, true);
    orderFinals(ctx);
    return ctx.matches;
  }

  function orderFinals(ctx) {
    // Pro Runde zuerst die Platzierungsspiele, das Spiel um Platz 1 zuletzt
    ctx.matches.sort((a, b) => a.round - b.round || b.bracket - a.bracket);
    ctx.matches.forEach((m, i) => {
      m.order = i;
    });
  }

  function qualifierCount(t) {
    const s = t.settings;
    return s.groupCount * s.advancePerGroup + s.extraQualifiers;
  }

  function hasFinals(s) {
    return s.format === 'groups_ko' || (s.format === 'groups' && s.placements && s.groupCount > 1);
  }

  function sortByPerformance(rows) {
    const per = (v, r) => (r.played ? v / r.played : 0);
    return rows.slice().sort(
      (a, b) =>
        per(b.points, b) - per(a.points, a) ||
        per(b.diff, b) - per(a.diff, a) ||
        per(b.scored, b) - per(a.scored, a) ||
        a.group - b.group
    );
  }

  /** Teams pro Gruppenrang über alle Gruppen, jeweils nach Leistung pro Spiel sortiert. */
  function rankTiers(t) {
    const tables = groupTables(t);
    const maxLen = Math.max(0, ...tables.map((rows) => rows.length));
    const tiers = [];
    for (let rank = 0; rank < maxLen; rank++) {
      tiers.push(
        sortByPerformance(tables.map((rows, gi) => rows[rank] && Object.assign({}, rows[rank], { group: gi })).filter(Boolean))
      );
    }
    return tiers;
  }

  /** Setzliste für die KO-Phase aus den Gruppentabellen. */
  function koEntries(t) {
    return splitQualifiers(t).qualified;
  }

  function splitQualifiers(t) {
    const s = t.settings;
    if (!usesGroups(s)) return { qualified: t.teams.map((team) => ({ team: team.id, group: null })), rest: [] };
    const tiers = rankTiers(t);
    const qualified = [];
    const rest = [];
    tiers.forEach((tier, rank) => {
      if (rank < s.advancePerGroup) qualified.push(...tier);
      else if (rank === s.advancePerGroup && s.extraQualifiers > 0) {
        qualified.push(...tier.slice(0, s.extraQualifiers));
        rest.push(...tier.slice(s.extraQualifiers));
      } else rest.push(...tier);
    });
    const map = (r) => ({ team: r.id, group: r.group });
    return { qualified: qualified.map(map), rest: rest.map(map) };
  }

  /** Spiele und Schlussränge der KO- bzw. Platzierungsrunde. */
  function buildFinals(t) {
    const s = t.settings;
    const ctx = { matches: [], places: [] };
    const full = { full: true, thirdPlace: true };
    if (s.format === 'ko') {
      const entries = t.teams.map((team) => ({ team: team.id, group: null }));
      buildPlayoff(ctx, seededSources(entries), 1, 0, { full: s.placements, thirdPlace: s.thirdPlace }, true);
    } else if (s.format === 'groups_ko') {
      const { qualified, rest } = splitQualifiers(t);
      buildPlayoff(ctx, seededSources(qualified), 1, 0, { full: s.placements, thirdPlace: s.thirdPlace }, true);
      if (s.placements && rest.length) buildPlayoff(ctx, seededSources(rest), qualified.length + 1, 0, full, false);
    } else if (hasFinals(s)) {
      // Gruppen ohne KO: Gleichplatzierte der Gruppen spielen um ihre Ränge
      let place = 1;
      rankTiers(t).forEach((tier, rank) => {
        const entries = tier.map((r) => ({ team: r.id, group: r.group }));
        buildPlayoff(ctx, seededSources(entries), place, 0, full, rank === 0 && entries.length > 1);
        place += entries.length;
      });
    }
    orderFinals(ctx);
    return ctx;
  }

  function groupPhaseComplete(t) {
    return t.matches.filter((m) => m.phase === 'group').every(isPlayed);
  }

  function startFinals(t, opts) {
    if (!hasFinals(t.settings)) throw new Error('Für dieses Turnier ist keine Finalrunde eingestellt.');
    if (t.stage !== 'groups') throw new Error('Die Finalrunde kann nur nach der Gruppenphase gestartet werden.');
    if (!groupPhaseComplete(t) && !(opts && opts.force)) {
      throw new Error('Es sind noch nicht alle Gruppenspiele gespielt.');
    }
    const finals = buildFinals(t);
    if (!finals.matches.length && !finals.places.length) throw new Error('Es gibt keine Spiele für die Finalrunde.');
    t.matches = t.matches.filter((m) => m.phase !== 'ko').concat(finals.matches);
    t.places = finals.places;
    t.stage = 'ko';
    if (t.timer && !t.matches.some((m) => m.id === t.timer.matchId)) t.timer = null;
    scheduleAll(t);
    resolveKO(t);
    return t;
  }

  function resetFinals(t) {
    if (!usesGroups(t.settings)) return resetTournament(t);
    t.matches = t.matches.filter((m) => m.phase !== 'ko');
    t.places = [];
    if (t.timer && !t.matches.some((m) => m.id === t.timer.matchId)) t.timer = null;
    t.stage = 'groups';
  }

  function matchWinner(m) {
    if (!m.home || !m.away || !isPlayed(m)) return null;
    if (m.scoreH > m.scoreA) return m.home;
    if (m.scoreA > m.scoreH) return m.away;
    return m.winner === m.home || m.winner === m.away ? m.winner : null;
  }

  function matchLoser(m) {
    const w = matchWinner(m);
    if (!w) return null;
    return w === m.home ? m.away : m.home;
  }

  function resolveSource(src, byId) {
    if (!src) return null;
    if (src.team) return src.team;
    const sm = byId.get(src.winner || src.loser);
    if (!sm) return null;
    return src.winner ? matchWinner(sm) : matchLoser(sm);
  }

  /**
   * Bestimmt die Teams der KO-Spiele aus den Resultaten der Vorrunden.
   * Ändert sich dadurch die Besetzung eines bereits gespielten Spiels, wird dessen Resultat gelöscht.
   */
  function resolveKO(t) {
    const ko = t.matches.filter((m) => m.phase === 'ko').sort((a, b) => a.order - b.order);
    if (!ko.length) return t;
    const byId = new Map(ko.map((m) => [m.id, m]));
    for (let guard = 0; guard < ko.length + 2; guard++) {
      for (const m of ko) {
        m.home = resolveSource(m.homeSrc, byId);
        m.away = resolveSource(m.awaySrc, byId);
      }
      let changed = false;
      for (const m of ko) {
        if (!isPlayed(m) && m.winner === null) continue;
        const valid = m.resultFor && m.resultFor[0] === m.home && m.resultFor[1] === m.away;
        if (!valid) {
          m.scoreH = null;
          m.scoreA = null;
          m.winner = null;
          m.resultFor = null;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* Resultate                                                           */
  /* ------------------------------------------------------------------ */

  function parseScore(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 999) throw new Error('Bitte eine ganze Zahl zwischen 0 und 999 eingeben.');
    return n;
  }

  function setResult(t, matchId, scoreH, scoreA, winner) {
    const m = t.matches.find((x) => x.id === matchId);
    if (!m) throw new Error('Spiel nicht gefunden.');
    if (m.phase === 'group' && t.stage !== 'groups') {
      throw new Error('Die Gruppenphase ist abgeschlossen. Setze zuerst die Finalrunde zurück, um Gruppenresultate zu ändern.');
    }
    const h = parseScore(scoreH);
    const a = parseScore(scoreA);
    if ((h === null) !== (a === null)) throw new Error('Bitte beide Resultate eingeben.');
    if (m.phase === 'ko') {
      resolveKO(t);
      if (h !== null && (!m.home || !m.away)) throw new Error('Die Teams dieses Spiels stehen noch nicht fest.');
    }
    m.scoreH = h;
    m.scoreA = a;
    m.winner = m.phase === 'ko' && h !== null && h === a && (winner === m.home || winner === m.away) ? winner : null;
    m.resultFor = h === null ? null : [m.home, m.away];
    if (m.phase === 'ko') resolveKO(t);
    return m;
  }

  /* ------------------------------------------------------------------ */
  /* Auswertung                                                          */
  /* ------------------------------------------------------------------ */

  function progress(t) {
    const total = t.matches.length;
    const played = t.matches.filter(isPlayed).length;
    return { total, played };
  }

  /** Schlussrangliste: [{place, teams:[id]}] oder null, solange nicht alles entschieden ist. */
  function finalRanking(t) {
    const s = t.settings;
    if (t.stage === 'ko' && t.places.length) {
      const byId = new Map(t.matches.filter((m) => m.phase === 'ko').map((m) => [m.id, m]));
      const out = [];
      for (const p of t.places) {
        const teams = p.srcs.map((src) => resolveSource(src, byId));
        if (teams.some((x) => !x)) return null;
        out.push({ place: p.place, teams });
      }
      return out.sort((a, b) => a.place - b.place);
    }
    if (t.stage === 'groups' && s.format === 'groups' && s.groupCount === 1 && groupPhaseComplete(t)) {
      return groupTables(t)[0].map((r) => ({ place: r.rank, teams: [r.id] }));
    }
    return null;
  }

  function isFinished(t) {
    if (t.stage === 'setup') return false;
    if (t.stage === 'ko') return t.matches.filter((m) => m.phase === 'ko').every(isPlayed) && !!finalRanking(t);
    return t.settings.format === 'groups' && !hasFinals(t.settings) && groupPhaseComplete(t);
  }

  /* ------------------------------------------------------------------ */
  /* Spieluhr                                                            */
  /* ------------------------------------------------------------------ */

  function matchMinutes(t, m) {
    return m && m.phase === 'ko' ? t.settings.koMatchDuration : t.settings.matchDuration;
  }

  function createTimer(t, matchId, owner) {
    const m = t.matches.find((x) => x.id === matchId);
    if (!m) throw new Error('Spiel nicht gefunden.');
    return {
      matchId,
      phase: 'game',
      durationMs: matchMinutes(t, m) * 60000,
      running: false,
      startedAt: null,
      elapsedMs: 0,
      halftimeDone: false,
      owner: owner || null,
    };
  }

  function timerElapsed(tm, now) {
    if (!tm) return 0;
    return Math.max(0, tm.elapsedMs + (tm.running && Number.isFinite(tm.startedAt) ? now - tm.startedAt : 0));
  }

  function timerRemaining(tm, now) {
    return Math.max(0, tm.durationMs - timerElapsed(tm, now));
  }

  function timerStart(tm, now, owner) {
    if (tm.running) return;
    if (tm.elapsedMs >= tm.durationMs) return;
    tm.running = true;
    tm.startedAt = now;
    if (owner) tm.owner = owner;
  }

  function timerPause(tm, now) {
    if (!tm.running) return;
    tm.elapsedMs = timerElapsed(tm, now);
    tm.running = false;
    tm.startedAt = null;
  }

  function timerAdjust(tm, now, deltaMs) {
    const elapsed = timerElapsed(tm, now);
    tm.durationMs = Math.max(elapsed + 1000, tm.durationMs + deltaMs, 1000);
  }

  /** Die Spiele, die im selben Zeitfenster laufen wie das gewählte Spiel. */
  function slotMatches(t, matchId) {
    const m = t.matches.find((x) => x.id === matchId);
    if (!m) return [];
    return t.matches.filter((x) => x.phase === m.phase && x.start === m.start).sort((a, b) => a.field - b.field);
  }

  function nextSlotMatch(t, matchId) {
    const m = t.matches.find((x) => x.id === matchId);
    if (!m) return null;
    const later = t.matches
      .filter((x) => x.start > m.start || (x.start === m.start && x.phase !== m.phase && x.phase === 'ko'))
      .sort((a, b) => a.start - b.start || a.field - b.field);
    return later.find((x) => !isPlayed(x)) || later[0] || null;
  }

  function timerBreak(t, now) {
    const tm = t.timer;
    if (!tm) return;
    Object.assign(tm, {
      phase: 'break',
      durationMs: Math.max(1, t.settings.breakDuration) * 60000,
      elapsedMs: 0,
      running: true,
      startedAt: now,
      halftimeDone: true,
    });
  }

  function timerNext(t, owner) {
    const tm = t.timer;
    if (!tm) return;
    const next = nextSlotMatch(t, tm.matchId);
    t.timer = next ? createTimer(t, next.id, owner || tm.owner) : null;
  }

  /**
   * Prüft Übergänge der Spieluhr (Halbzeit, Spielende, Ende der Wechselpause).
   * Gibt die eingetretenen Ereignisse zurück und passt t.timer an.
   */
  function timerTick(t, now) {
    const tm = t.timer;
    if (!tm || !tm.running) return [];
    const s = t.settings;
    const el = timerElapsed(tm, now);
    if (tm.phase === 'game') {
      if (s.timerHalves === 2 && !tm.halftimeDone && el >= tm.durationMs / 2 && el < tm.durationMs) {
        tm.elapsedMs = Math.round(tm.durationMs / 2);
        tm.running = false;
        tm.startedAt = null;
        tm.halftimeDone = true;
        return ['halftime'];
      }
      if (el >= tm.durationMs) {
        if (s.breakDuration > 0) timerBreak(t, now);
        else {
          tm.elapsedMs = tm.durationMs;
          tm.running = false;
          tm.startedAt = null;
        }
        return ['end'];
      }
      return [];
    }
    if (el >= tm.durationMs) {
      timerNext(t);
      return ['break-end'];
    }
    return [];
  }

  /** Bezeichnung des aktuellen Abschnitts der Spieluhr. */
  function timerPhaseLabel(t, now) {
    const tm = t.timer;
    if (!tm) return '';
    if (tm.phase === 'break') return 'Wechselpause';
    const el = timerElapsed(tm, now);
    if (el >= tm.durationMs) return 'Spielende';
    if (t.settings.timerHalves === 2) {
      if (tm.halftimeDone && !tm.running && Math.abs(el - tm.durationMs / 2) < 1000) return 'Halbzeit · Seitenwechsel';
      return tm.halftimeDone ? '2. Halbzeit' : '1. Halbzeit';
    }
    return el === 0 && !tm.running ? 'Bereit' : 'Spielzeit';
  }

  function formatClock(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  return {
    FORMATS,
    TIEBREAKERS,
    DEFAULT_SETTINGS,
    SCHEDULE_KEYS,
    uid,
    clone,
    shuffle,
    groupLetter,
    groupName,
    parseTime,
    formatTime,
    isPlayed,
    normalizeSettings,
    createTournament,
    normalizeTournament,
    usesGroups,
    usesKO,
    hasFinals,
    teamsByGroup,
    fillUnassigned,
    drawGroups,
    roundRobin,
    scheduleMatches,
    scheduleAll,
    applyTimes,
    slotTimes,
    lunchWindow,
    endTime,
    validateSetup,
    startTournament,
    previewTournament,
    resetTournament,
    computeTable,
    groupTables,
    drawLots,
    clearLots,
    seedOrder,
    buildBracket,
    buildFinals,
    koEntries,
    splitQualifiers,
    qualifierCount,
    groupPhaseComplete,
    startFinals,
    startKO: startFinals,
    resetFinals,
    resetKO: resetFinals,
    resolveKO,
    matchWinner,
    matchLoser,
    setResult,
    progress,
    finalRanking,
    isFinished,
    createTimer,
    timerElapsed,
    timerRemaining,
    timerStart,
    timerPause,
    timerAdjust,
    timerBreak,
    timerNext,
    timerTick,
    timerPhaseLabel,
    slotMatches,
    nextSlotMatch,
    formatClock,
  };
});
