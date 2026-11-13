/*
 * TournamentBuilder – Benutzeroberfläche
 * Speichert alle Turniere im localStorage des Browsers.
 */
(function () {
  'use strict';

  const C = window.TBCore;
  const STORE_KEY = 'tournamentbuilder.v1';
  const UI_KEY = 'tournamentbuilder.ui';
  const EMBEDDED = (() => {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  })();
  const BEAMER_WINDOW = new URLSearchParams(location.search).get('view') === 'beamer';

  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');

  let storageOk = true;
  let store = loadStore();
  let ui = Object.assign(
    { tab: 'teams', filter: 'all', team: 'all', field: 'all', openOnly: false, sound: true, refField: 1, refDrafts: {} },
    loadUi()
  );
  if (!ui.refDrafts || typeof ui.refDrafts !== 'object') ui.refDrafts = {};
  ui.beamer = BEAMER_WINDOW;
  let renderQueued = false;

  /* ------------------------------------------------------------------ */
  /* Speicher                                                            */
  /* ------------------------------------------------------------------ */

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.tournaments && typeof data.tournaments === 'object') {
          const out = { activeId: data.activeId, tournaments: {} };
          for (const t of Object.values(data.tournaments)) {
            try {
              const n = C.normalizeTournament(t);
              out.tournaments[n.id] = n;
            } catch (e) {
              /* defekten Eintrag überspringen */
            }
          }
          return out;
        }
      }
    } catch (e) {
      storageOk = false;
    }
    return { activeId: null, tournaments: {} };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      storageOk = true;
    } catch (e) {
      if (storageOk) toast('Dieser Browser speichert nichts. Exportiere das Turnier regelmässig.', 'error');
      storageOk = false;
    }
  }

  function loadUi() {
    try {
      return JSON.parse(localStorage.getItem(UI_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveUi() {
    try {
      const { tab, filter, team, field, openOnly, sound, refField, refDrafts } = ui;
      localStorage.setItem(UI_KEY, JSON.stringify({ tab, filter, team, field, openOnly, sound, refField, refDrafts }));
    } catch (e) {
      /* egal */
    }
  }

  function demoTournament() {
    const t = C.createTournament('Sporttag Unihockey (Beispiel)');
    ['1a', '1b', '2a', '2b', '3a', '3b', '4a', '4b'].forEach((n) =>
      t.teams.push({ id: C.uid('team'), name: 'Klasse ' + n, group: null })
    );
    C.drawGroups(t);
    return t;
  }

  function current() {
    let t = store.tournaments[store.activeId];
    if (!t) {
      const list = Object.values(store.tournaments).sort((a, b) => b.created - a.created);
      if (list.length) {
        t = list[0];
      } else {
        t = demoTournament();
        store.tournaments[t.id] = t;
      }
      store.activeId = t.id;
      save();
    }
    return t;
  }

  /** Führt eine Änderung aus, speichert und zeichnet neu. */
  function mutate(fn, opts) {
    const t = current();
    if (isReadOnly(t)) {
      toast('Dieses Live-Turnier kannst du nur ansehen.', 'error');
      queueRender();
      return false;
    }
    const before = opts && opts.undo === false ? null : JSON.stringify(t);
    try {
      fn(t);
    } catch (e) {
      toast(e.message, 'error');
      queueRender();
      return false;
    }
    C.resolveKO(t);
    if (before !== null && before !== JSON.stringify(t)) {
      undoStack.push({ tid: t.id, json: before, label: (opts && opts.label) || 'Änderung' });
      if (undoStack.length > 40) undoStack.shift();
    }
    save();
    pushLive(t);
    if (opts && opts.defer) queueRender();
    else render();
    return true;
  }

  /* Rückgängig: Zustände vor den letzten Änderungen (nur in dieser Sitzung) */
  const undoStack = [];
  const NO_UNDO = { undo: false };

  function canUndo(t) {
    return undoStack.some((u) => u.tid === t.id) && !isReadOnly(t);
  }

  function undo() {
    const t = current();
    if (isReadOnly(t)) return;
    let i = undoStack.length - 1;
    while (i >= 0 && undoStack[i].tid !== t.id) i--;
    if (i < 0) return toast('Es gibt nichts rückgängig zu machen.');
    const [entry] = undoStack.splice(i, 1);
    let restored;
    try {
      restored = C.normalizeTournament(JSON.parse(entry.json));
    } catch (e) {
      return toast('Rückgängig ist fehlgeschlagen.', 'error');
    }
    // Spieluhr und Live-Status laufen weiter wie bisher
    restored.timer = t.timer && restored.matches.some((m) => m.id === t.timer.matchId) ? t.timer : null;
    restored.live = t.live;
    restored.created = t.created;
    store.tournaments[t.id] = restored;
    C.resolveKO(restored);
    save();
    pushLive(restored);
    render();
    toast('Rückgängig gemacht: ' + entry.label);
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => {
      renderQueued = false;
      render();
    }, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Hilfsfunktionen                                                     */
  /* ------------------------------------------------------------------ */

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function teamMap(t) {
    return new Map(t.teams.map((team) => [team.id, team.name]));
  }

  function srcLabel(t, src, names) {
    if (!src) return '?';
    if (src.team) return names.get(src.team) || '?';
    const ref = t.matches.find((m) => m.id === (src.winner || src.loser));
    if (!ref) return '?';
    return (src.winner ? 'Sieger ' : 'Verlierer ') + ref.label;
  }

  function sideName(t, m, side, names) {
    const id = side === 'h' ? m.home : m.away;
    if (id) return { text: names.get(id) || '?', known: true };
    if (m.phase === 'ko') return { text: srcLabel(t, side === 'h' ? m.homeSrc : m.awaySrc, names), known: false };
    return { text: '?', known: false };
  }

  function matchTag(t, m) {
    if (m.phase === 'group') return t.settings.groupCount > 1 ? C.groupName(m.group) : 'Runde ' + (m.round + 1);
    return m.label;
  }

  function fieldLabel(t, m) {
    return t.settings.fieldName + ' ' + m.field;
  }

  function finalsName(t) {
    return t.settings.format === 'groups' ? 'Platzierungsspiele' : 'KO-Phase';
  }

  function stageLabel(t) {
    if (C.isFinished(t)) return 'Abgeschlossen';
    return { setup: 'Vorbereitung', groups: 'Gruppenphase', ko: finalsName(t) }[t.stage];
  }

  function toast(text, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.textContent = text;
    toastRoot.appendChild(el);
    setTimeout(() => el.classList.add('toast-out'), 3600);
    setTimeout(() => el.remove(), 4000);
  }

  const CLOCK_ICON =
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9v4l3 2M9 2h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  const LOGO =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
    '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'd="M3 4h5v6H3M3 14h5v6H3M8 7h3v10H8M11 12h4M15 9h6v6h-6"/></svg>';

  /* ------------------------------------------------------------------ */
  /* Dialoge (ersetzen alert/confirm/prompt)                             */
  /* ------------------------------------------------------------------ */

  let modalState = null;

  function openModal(opts) {
    closeModal(null);
    return new Promise((resolve) => {
      const actions = (opts.actions || [{ label: 'OK', value: true, kind: 'primary' }])
        .map(
          (a) =>
            `<button type="button" class="btn ${a.kind ? 'btn-' + a.kind : ''}" data-modal="${esc(a.value)}"${
              a.cmd ? ` data-modal-cmd="${esc(a.cmd)}"` : ''
            }>${esc(a.label)}</button>`
        )
        .join('');
      modalRoot.innerHTML = `
        <div class="modal-backdrop" data-modal-backdrop>
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <h2 id="modal-title">${esc(opts.title)}</h2>
            <div class="modal-body">${opts.body || ''}</div>
            <div class="modal-actions">${actions}</div>
          </div>
        </div>`;
      modalState = { resolve, onCommand: opts.onCommand, collect: opts.collect, returnFocus: document.activeElement };
      const first = modalRoot.querySelector('input, textarea, select') || modalRoot.querySelector('.btn-primary, .btn-danger');
      if (first) first.focus();
    });
  }

  function closeModal(value) {
    if (!modalState) return;
    const st = modalState;
    modalState = null;
    let result = value;
    if (value !== null && st.collect) result = st.collect(modalRoot, value);
    modalRoot.innerHTML = '';
    if (st.returnFocus && document.contains(st.returnFocus)) st.returnFocus.focus();
    st.resolve(result);
  }

  modalRoot.addEventListener('click', (e) => {
    if (!modalState) return;
    if (e.target.matches('[data-modal-backdrop]')) return closeModal(null);
    const btn = e.target.closest('[data-modal]');
    if (!btn) return;
    if (btn.dataset.modalCmd) {
      if (modalState.onCommand) modalState.onCommand(btn.dataset.modalCmd, modalRoot);
      return;
    }
    const v = btn.dataset.modal;
    closeModal(v === 'null' ? null : v);
  });

  modalRoot.addEventListener('submit', (e) => {
    e.preventDefault();
    const primary = modalRoot.querySelector('.btn-primary, .btn-danger');
    if (primary) primary.click();
  });

  function confirmDialog(title, text, okLabel, danger) {
    return openModal({
      title,
      body: `<p>${esc(text)}</p>`,
      actions: [
        { label: 'Abbrechen', value: 'null' },
        { label: okLabel || 'OK', value: 'ok', kind: danger ? 'danger' : 'primary' },
      ],
    }).then((v) => v === 'ok');
  }

  function promptDialog(title, label, value) {
    return openModal({
      title,
      body: `<form><label class="field-label" for="modal-input">${esc(label)}</label>
             <input id="modal-input" class="input" maxlength="80" value="${esc(value || '')}" autocomplete="off"></form>`,
      actions: [
        { label: 'Abbrechen', value: 'null' },
        { label: 'OK', value: 'ok', kind: 'primary' },
      ],
      collect: (root) => root.querySelector('#modal-input').value.trim(),
    }).then((v) => (v ? v : null));
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: Rahmen                                                   */
  /* ------------------------------------------------------------------ */

  function availableTabs(t) {
    const s = t.settings;
    const tabs = [
      ['teams', 'Teams'],
      ['settings', 'Einstellungen'],
      ['schedule', 'Spielplan'],
    ];
    if (C.usesGroups(s)) tabs.push(['tables', 'Tabellen']);
    if (C.usesKO(s)) tabs.push(['ko', s.format === 'groups' ? 'Finalrunde' : 'KO-Phase']);
    if (t.stage !== 'setup') tabs.push(['referee', 'Schiri']);
    return tabs;
  }

  function render() {
    const t = current();
    C.resolveKO(t);
    const active = document.activeElement;
    const focusKey = active && active.dataset ? active.dataset.key : null;
    let caret = null;
    try {
      caret = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    } catch (e) {
      caret = null;
    }

    document.title = t.name + ' · TournamentBuilder';
    document.body.classList.toggle('is-beamer', !!ui.beamer);
    document.body.classList.toggle('has-timer', !!t.timer && !ui.beamer && ui.tab !== 'referee');
    app.innerHTML = ui.beamer ? renderBeamer(t) : renderMain(t);
    attachLive();
    updateTimerDisplays(t, Date.now());

    if (focusKey && !modalState) {
      const el = app.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
      if (el && !el.disabled) {
        el.focus();
        try {
          if (caret !== null) el.setSelectionRange(caret, caret);
        } catch (e) {
          /* number-Felder kennen keine Auswahl */
        }
      }
    }
  }

  function renderMain(t) {
    const tabs = availableTabs(t);
    if (!tabs.some(([k]) => k === ui.tab)) ui.tab = 'teams';
    const list = Object.values(store.tournaments).sort((a, b) => b.created - a.created);
    const remoteOnly = live.list.filter((x) => !store.tournaments[x.id]).sort((a, b) => b.updated - a.updated);
    const prog = C.progress(t);
    const pct = prog.total ? Math.round((prog.played / prog.total) * 100) : 0;

    const content = {
      teams: renderTeams,
      settings: renderSettings,
      schedule: renderSchedule,
      tables: renderTables,
      ko: renderKO,
      referee: renderReferee,
    }[ui.tab](t);

    return `
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">${LOGO}<span>TournamentBuilder</span></div>
          <div class="switcher">
            <label class="sr-only" for="tour-select">Turnier wählen</label>
            <select id="tour-select" class="input input-compact" data-change="switch">
              ${list.map((x) => `<option value="${esc(x.id)}"${x.id === t.id ? ' selected' : ''}>${esc(x.name)}${x.live ? ' (live)' : ''}</option>`).join('')}
              ${
                remoteOnly.length
                  ? `<optgroup label="Live-Turniere von anderen Geräten">${remoteOnly
                      .map((x) => `<option value="live:${esc(x.id)}">${esc(x.name)}</option>`)
                      .join('')}</optgroup>`
                  : ''
              }
            </select>
          </div>
          <div class="top-actions">
            <button type="button" class="btn btn-ghost" data-action="undo" title="Letzte Änderung rückgängig machen (Strg+Z)"${canUndo(t) ? '' : ' disabled'}>Rückgängig</button>
            <button type="button" class="btn btn-ghost" data-action="new">Neu</button>
            <button type="button" class="btn btn-ghost" data-action="duplicate" title="Teams und Einstellungen übernehmen, ohne Resultate">Kopie</button>
            <button type="button" class="btn btn-ghost" data-action="export">Export</button>
            <button type="button" class="btn btn-ghost" data-action="import">Import</button>
            <button type="button" class="btn btn-ghost" data-action="delete">Löschen</button>
            ${
              live.db
                ? t.live
                  ? '<button type="button" class="btn btn-ghost" data-action="live-stop">Live beenden</button>'
                  : '<button type="button" class="btn btn-ghost" data-action="live-start" title="Turnier mit anderen Geräten synchronisieren">Live teilen</button>'
                : ''
            }
            <button type="button" class="btn btn-court" data-action="beamer">Beamer</button>
          </div>
        </div>
      </header>
      ${storageOk ? '' : '<div class="banner">Der Browser speichert keine Daten. Exportiere das Turnier, bevor du die Seite schliesst.</div>'}
      <div class="page">
        <section class="hero">
          <label class="sr-only" for="tour-name">Turniername</label>
          <input id="tour-name" class="title-input" data-field="name" data-key="tour-name" maxlength="80" value="${esc(t.name)}">
          <div class="hero-meta">
            <span class="pill pill-${C.isFinished(t) ? 'done' : t.stage}">${esc(stageLabel(t))}</span>
            ${liveStatus(t)}
            <span class="meta-text">${t.teams.length} Teams · ${esc(C.FORMATS[t.settings.format])}</span>
            ${
              prog.total
                ? `<span class="meta-text tabular">${prog.played}/${prog.total} Spiele</span>
                   <span class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Fortschritt"><span style="width:${pct}%"></span></span>`
                : ''
            }
          </div>
        </section>
        <nav class="tabs" role="tablist" aria-label="Bereiche">
          ${tabs
            .map(
              ([k, label]) =>
                `<button type="button" role="tab" class="tab${ui.tab === k ? ' is-active' : ''}" aria-selected="${
                  ui.tab === k
                }" data-tab="${k}">${label}</button>`
            )
            .join('')}
        </nav>
        <main class="content">${content}</main>
        <footer class="foot">${
          t.live
            ? 'Live-Turnier: Änderungen erscheinen auf allen Geräten, die diese Seite geöffnet haben.'
            : 'Alle Daten bleiben in diesem Browser gespeichert. Für einen anderen Computer: Export und Import' + (live.db ? ' oder «Live teilen».' : '.')
        }</footer>
      </div>
      ${ui.tab === 'referee' ? '' : renderTimerBar(t)}`;
  }

  /* ------------------------------------------------------------------ */
  /* Teams                                                               */
  /* ------------------------------------------------------------------ */

  function renderTeams(t) {
    const s = t.settings;
    const locked = t.stage !== 'setup';
    const groups = C.usesGroups(s) && s.groupCount > 1;
    const isKO = s.format === 'ko';
    const sizes = groups ? C.teamsByGroup(t).map((g) => g.length) : [];
    const unassigned = groups ? t.teams.filter((x) => !(Number.isInteger(x.group) && x.group < s.groupCount)).length : 0;

    const rows = t.teams
      .map((team, i) => {
        const groupSelect = groups
          ? `<label class="sr-only" for="tg-${esc(team.id)}">Gruppe von ${esc(team.name)}</label>
             <select id="tg-${esc(team.id)}" class="input input-compact" data-team-group="${esc(team.id)}"${locked ? ' disabled' : ''}>
               <option value="">ohne Gruppe</option>
               ${Array.from({ length: s.groupCount }, (_, g) => `<option value="${g}"${team.group === g ? ' selected' : ''}>${esc(C.groupName(g))}</option>`).join('')}
             </select>`
          : '';
        const orderBtns =
          isKO && !locked
            ? `<button type="button" class="icon-btn" data-action="team-up" data-id="${esc(team.id)}" aria-label="Nach oben"${i === 0 ? ' disabled' : ''}>↑</button>
               <button type="button" class="icon-btn" data-action="team-down" data-id="${esc(team.id)}" aria-label="Nach unten"${i === t.teams.length - 1 ? ' disabled' : ''}>↓</button>`
            : '';
        return `<li class="team-row">
            <span class="seed tabular">${i + 1}</span>
            <label class="sr-only" for="tn-${esc(team.id)}">Name von Team ${i + 1}</label>
            <input id="tn-${esc(team.id)}" class="input" maxlength="60" data-team-name="${esc(team.id)}" data-key="tn-${esc(team.id)}" value="${esc(team.name)}">
            ${groupSelect}${orderBtns}
            <button type="button" class="icon-btn icon-danger" data-action="team-del" data-id="${esc(team.id)}" aria-label="${esc(team.name)} löschen"${locked ? ' disabled' : ''}>✕</button>
          </li>`;
      })
      .join('');

    return `
      ${locked ? '<div class="callout">Das Turnier läuft. Teams können nur noch umbenannt werden. Für andere Änderungen das Turnier im Spielplan zurücksetzen.</div>' : ''}
      <div class="cols">
        <section class="card">
          <h2>Teams hinzufügen</h2>
          <form class="inline-form" data-form="add-team">
            <label class="sr-only" for="new-team">Teamname</label>
            <input id="new-team" name="name" class="input" maxlength="60" placeholder="z. B. Klasse 3b" autocomplete="off" data-key="new-team"${locked ? ' disabled' : ''}>
            <button class="btn btn-primary"${locked ? ' disabled' : ''}>Hinzufügen</button>
          </form>
          <details class="bulk">
            <summary>Mehrere Teams auf einmal</summary>
            <form data-form="bulk-add">
              <label class="field-label" for="bulk-names">Ein Team pro Zeile (z. B. aus einer Klassenliste kopieren)</label>
              <textarea id="bulk-names" name="names" class="input" rows="6"${locked ? ' disabled' : ''}></textarea>
              <button class="btn btn-primary"${locked ? ' disabled' : ''}>Alle hinzufügen</button>
            </form>
          </details>
          ${
            !locked && t.teams.length
              ? `<div class="btn-row">
                  ${groups ? '<button type="button" class="btn" data-action="draw-groups">Gruppen zufällig auslosen</button>' : ''}
                  ${isKO ? '<button type="button" class="btn" data-action="shuffle-teams">Setzliste mischen</button>' : ''}
                  <button type="button" class="btn btn-ghost" data-action="clear-teams">Alle Teams entfernen</button>
                </div>`
              : ''
          }
          ${isKO ? '<p class="hint">Die Reihenfolge der Liste ist die Setzliste: Team 1 trifft erst im Final auf Team 2. Bei ungerader Anzahl erhalten die besten Teams ein Freilos.</p>' : ''}
        </section>
        <section class="card">
          <h2>Teams <span class="count">${t.teams.length}</span></h2>
          ${
            groups
              ? `<div class="chips">${sizes.map((n, g) => `<span class="chip">${esc(C.groupName(g))}: ${n}</span>`).join('')}${
                  unassigned ? `<span class="chip chip-warn">ohne Gruppe: ${unassigned}</span>` : ''
                }</div>`
              : ''
          }
          ${t.teams.length ? `<ol class="team-list">${rows}</ol>` : '<p class="empty">Noch keine Teams. Füge links das erste Team hinzu.</p>'}
          ${groups && unassigned && !locked ? '<p class="hint">Teams ohne Gruppe werden beim Start automatisch der kleinsten Gruppe zugeteilt.</p>' : ''}
        </section>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Einstellungen                                                       */
  /* ------------------------------------------------------------------ */

  const LOCKS = {
    structure: ['format', 'groupCount', 'legs'],
    ko: ['advancePerGroup', 'extraQualifiers', 'thirdPlace', 'placements'],
    ranking: ['pointsWin', 'pointsDraw', 'pointsLoss', 'tiebreakers'],
  };

  function isLocked(t, key) {
    if (LOCKS.structure.includes(key)) return t.stage !== 'setup';
    if (LOCKS.ko.includes(key)) return t.stage === 'ko' || (t.settings.format === 'ko' && t.stage !== 'setup');
    if (t.live && live.readOnly) return true;
    if (LOCKS.ranking.includes(key)) return t.stage === 'ko';
    return false;
  }

  function numField(t, key, label, min, max, hint) {
    const id = 'set-' + key;
    return `<div class="field">
        <label class="field-label" for="${id}">${esc(label)}</label>
        <input id="${id}" class="input" type="number" inputmode="numeric" min="${min}" max="${max}" value="${esc(t.settings[key])}" data-setting="${key}"${isLocked(t, key) ? ' disabled' : ''}>
        ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      </div>`;
  }

  function textField(t, key, label, type, hint) {
    const id = 'set-' + key;
    return `<div class="field">
        <label class="field-label" for="${id}">${esc(label)}</label>
        <input id="${id}" class="input" type="${type || 'text'}" maxlength="20" value="${esc(t.settings[key])}" data-setting="${key}"${isLocked(t, key) ? ' disabled' : ''}>
        ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      </div>`;
  }

  function selectField(t, key, label, options) {
    const id = 'set-' + key;
    const v = String(t.settings[key]);
    return `<div class="field">
        <label class="field-label" for="${id}">${esc(label)}</label>
        <select id="${id}" class="input" data-setting="${key}"${isLocked(t, key) ? ' disabled' : ''}>
          ${options.map(([val, text]) => `<option value="${esc(val)}"${String(val) === v ? ' selected' : ''}>${esc(text)}</option>`).join('')}
        </select>
      </div>`;
  }

  function renderSettings(t) {
    const s = t.settings;
    const unit = s.scoreUnit;
    const tbLocked = isLocked(t, 'tiebreakers');
    const activeTb = s.tiebreakers;
    const inactiveTb = Object.keys(C.TIEBREAKERS).filter((k) => !activeTb.includes(k));
    const tbLabel = (k) => (k === 'diff' ? unit + 'differenz' : k === 'scored' ? 'Erzielte ' + unit : C.TIEBREAKERS[k]);

    return `
      ${t.stage !== 'setup' ? '<div class="callout">Das Turnier läuft. Gesperrte Felder lassen sich erst nach einem Zurücksetzen ändern. Zeitplan-Einstellungen wirken sofort.</div>' : ''}
      <div class="cols">
        <section class="card">
          <h2>Turnierform</h2>
          <div class="form-grid">
            ${selectField(t, 'format', 'Modus', Object.entries(C.FORMATS))}
            ${C.usesGroups(s) ? numField(t, 'groupCount', 'Anzahl Gruppen', 1, 26, s.groupCount === 1 ? 'Eine Gruppe = Liga, alle spielen gegen alle.' : '') : ''}
            ${C.usesGroups(s) ? selectField(t, 'legs', 'Jeder gegen jeden', [[1, 'Einfach (nur Hinspiel)'], [2, 'Doppelt (Hin- und Rückspiel)']]) : ''}
          </div>
        </section>
        ${
          s.format === 'groups'
            ? `<section class="card">
                <h2>Platzierungsspiele</h2>
                <div class="field field-check">
                  <input id="set-placements" type="checkbox" data-setting="placements"${s.placements ? ' checked' : ''}${isLocked(t, 'placements') || s.groupCount < 2 ? ' disabled' : ''}>
                  <label for="set-placements">Nach der Gruppenphase alle Plätze ausspielen</label>
                </div>
                <p class="hint">${
                  s.groupCount < 2
                    ? 'Braucht mindestens 2 Gruppen.'
                    : 'Die Gruppenersten spielen um Platz 1, die Gruppenzweiten um Platz 3 usw. So hat jedes Team ein Finalspiel.'
                }</p>
              </section>`
            : ''
        }
        ${
          s.format !== 'groups'
            ? `<section class="card">
                <h2>KO-Phase</h2>
                <div class="form-grid">
                  ${s.format === 'groups_ko' ? numField(t, 'advancePerGroup', 'Weiter pro Gruppe', 1, 32) : ''}
                  ${s.format === 'groups_ko' ? numField(t, 'extraQualifiers', 'Zusätzlich beste Nächstplatzierte', 0, 26, 'Z. B. die 2 besten Gruppendritten. Verglichen wird pro Spiel.') : ''}
                  <div class="field field-check">
                    <input id="set-thirdPlace" type="checkbox" data-setting="thirdPlace"${s.thirdPlace ? ' checked' : ''}${isLocked(t, 'thirdPlace') ? ' disabled' : ''}>
                    <label for="set-thirdPlace">Spiel um Platz 3</label>
                  </div>
                  <div class="field field-check">
                    <input id="set-placements" type="checkbox" data-setting="placements"${s.placements ? ' checked' : ''}${isLocked(t, 'placements') ? ' disabled' : ''}>
                    <label for="set-placements">Alle Plätze ausspielen</label>
                  </div>
                </div>
                ${s.placements ? `<p class="hint">Auch die Verlierer spielen weiter um ihre Plätze${s.format === 'groups_ko' ? ', und die nicht qualifizierten Teams spielen ihre Plätze unter sich aus' : ''}. So hat jedes Team gleich viele Spiele in der Finalrunde.</p>` : ''}
                ${s.format === 'groups_ko' ? `<p class="hint">Es kommen ${C.qualifierCount(t)} Teams in die KO-Phase. Teams aus derselben Gruppe treffen in der ersten Runde nicht aufeinander.</p>` : ''}
              </section>`
            : ''
        }
        ${
          C.usesGroups(s)
            ? `<section class="card">
                <h2>Punkte und Rangierung</h2>
                <div class="form-grid form-grid-3">
                  ${numField(t, 'pointsWin', 'Sieg', 0, 10)}
                  ${numField(t, 'pointsDraw', 'Unentschieden', 0, 10)}
                  ${numField(t, 'pointsLoss', 'Niederlage', 0, 10)}
                </div>
                <h3>Bei Gleichstand entscheidet</h3>
                <ol class="tb-list">
                  ${activeTb
                    .map(
                      (k, i) => `<li><span>${esc(tbLabel(k))}</span>
                        <span class="tb-actions">
                          <button type="button" class="icon-btn" data-action="tb-up" data-key-name="${k}" aria-label="${esc(tbLabel(k))} nach oben"${i === 0 || tbLocked ? ' disabled' : ''}>↑</button>
                          <button type="button" class="icon-btn" data-action="tb-down" data-key-name="${k}" aria-label="${esc(tbLabel(k))} nach unten"${i === activeTb.length - 1 || tbLocked ? ' disabled' : ''}>↓</button>
                          <button type="button" class="icon-btn icon-danger" data-action="tb-remove" data-key-name="${k}" aria-label="${esc(tbLabel(k))} entfernen"${activeTb.length === 1 || tbLocked ? ' disabled' : ''}>✕</button>
                        </span></li>`
                    )
                    .join('')}
                </ol>
                ${
                  inactiveTb.length && !tbLocked
                    ? `<div class="btn-row">${inactiveTb
                        .map((k) => `<button type="button" class="btn btn-ghost btn-small" data-action="tb-add" data-key-name="${k}">+ ${esc(tbLabel(k))}</button>`)
                        .join('')}</div>`
                    : ''
                }
                <p class="hint">Bleibt danach ein Gleichstand, wird er in der Tabelle mit = markiert (z. B. Los oder Penaltyschiessen).</p>
              </section>`
            : ''
        }
        <section class="card">
          <h2>Zeitplan</h2>
          <div class="form-grid">
            ${textField(t, 'startTime', 'Beginn', 'time')}
            ${numField(t, 'fields', 'Anzahl ' + s.fieldName + 'er', 1, 50, 'So viele Spiele laufen gleichzeitig.')}
            ${numField(t, 'matchDuration', 'Spieldauer (Min.)', 1, 300)}
            ${numField(t, 'breakDuration', 'Wechselpause (Min.)', 0, 120)}
            ${numField(t, 'minRest', 'Mindestpause pro Team (Runden)', 0, 10, '0 = Teams dürfen direkt hintereinander spielen.')}
            ${C.usesKO(s) ? numField(t, 'koMatchDuration', 'Spieldauer KO (Min.)', 1, 300) : ''}
            ${C.hasFinals(s) ? numField(t, 'koBreak', 'Pause vor Finalrunde (Min.)', 0, 600) : ''}
            ${textField(t, 'lunchStart', 'Mittagspause ab', 'time', 'Leer lassen = keine Mittagspause')}
            ${s.lunchStart ? numField(t, 'lunchDuration', 'Mittagspause (Min.)', 0, 300) : ''}
          </div>
          ${s.lunchStart ? '<button type="button" class="btn btn-ghost btn-small" data-action="clear-lunch">Mittagspause entfernen</button>' : ''}
        </section>
        <section class="card">
          <h2>Spieluhr</h2>
          <div class="form-grid">
            ${selectField(t, 'timerHalves', 'Spielabschnitte', [[1, 'Durchgehend'], [2, '2 Halbzeiten mit Seitenwechsel']])}
            ${numField(t, 'shiftInterval', 'Wechselsignal alle … Min.', 0, 60, '0 = aus. Z. B. 2 für Linienwechsel im Unihockey.')}
          </div>
          <p class="hint">Die Uhr startest du im Spielplan mit «Uhr» beim gewünschten Spiel. Sie läuft die Spieldauer (${s.matchDuration} Min.${C.usesKO(s) ? `, Finalrunde ${s.koMatchDuration} Min.` : ''}) herunter, danach die Wechselpause (${s.breakDuration} Min.) und springt dann zum nächsten Spiel.</p>
        </section>
        <section class="card">
          <h2>Bezeichnungen</h2>
          <div class="form-grid">
            ${textField(t, 'scoreUnit', 'Einheit für Resultate', 'text', 'Z. B. Tore, Punkte, Körbe, Sätze')}
            ${textField(t, 'fieldName', 'Name der Spielorte', 'text', 'Z. B. Feld, Platz, Tisch, Halle')}
          </div>
        </section>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Spielplan                                                           */
  /* ------------------------------------------------------------------ */

  function scoreInputs(t, m, names, readOnly) {
    const locked = (m.phase === 'group' && t.stage !== 'groups') || !m.home || !m.away || isReadOnly(t);
    const h = sideName(t, m, 'h', names).text;
    const a = sideName(t, m, 'a', names).text;
    if (readOnly) {
      return `<span class="score-static tabular">${C.isPlayed(m) ? `${m.scoreH}<span class="colon">:</span>${m.scoreA}` : '<span class="muted">–:–</span>'}</span>`;
    }
    const input = (side, value, team) =>
      `<input type="number" inputmode="numeric" min="0" max="999" class="score-input tabular" id="s${side}-${esc(m.id)}" data-key="s${side}-${esc(m.id)}" data-score="${side}" data-id="${esc(m.id)}" value="${value === null ? '' : esc(value)}" aria-label="${esc(t.settings.scoreUnit)} ${esc(team)}"${locked ? ' disabled' : ''}>`;
    return `<span class="score">${input('h', m.scoreH, h)}<span class="colon">:</span>${input('a', m.scoreA, a)}</span>`;
  }

  function winnerSelect(t, m, names, readOnly) {
    if (m.phase !== 'ko' || !C.isPlayed(m) || m.scoreH !== m.scoreA) return '';
    if (readOnly) return '';
    const opt = (id) => `<option value="${esc(id)}"${m.winner === id ? ' selected' : ''}>${esc(names.get(id))}</option>`;
    return `<div class="winner-pick${m.winner ? '' : ' needs'}">
        <label for="w-${esc(m.id)}">Unentschieden. Sieger nach Penalty / Verlängerung:</label>
        <select id="w-${esc(m.id)}" class="input input-compact" data-winner="${esc(m.id)}">
          <option value="">bitte wählen</option>${opt(m.home)}${opt(m.away)}
        </select>
      </div>`;
  }

  function matchRow(t, m, names, readOnly) {
    const h = sideName(t, m, 'h', names);
    const a = sideName(t, m, 'a', names);
    const w = C.matchWinner(m);
    const played = C.isPlayed(m);
    const cls = (id, known) =>
      ['m-team', known ? '' : 'is-tbd', w && w === id ? 'is-winner' : '', played && !w && m.phase === 'group' ? 'is-draw' : '']
        .filter(Boolean)
        .join(' ');
    const timerOn = t.timer && t.timer.matchId === m.id;
    const timerBtn = readOnly
      ? ''
      : `<button type="button" class="timer-pick${timerOn ? ' is-on' : ''}" data-action="timer-select" data-id="${esc(m.id)}" aria-pressed="${!!timerOn}" title="Spieluhr für dieses Spiel">${CLOCK_ICON}<span>Uhr</span></button>`;
    return `<div class="match${played ? ' is-played' : ''}${timerOn ? ' is-timed' : ''}" data-match="${esc(m.id)}">
        <div class="m-meta"><span class="m-field">${esc(fieldLabel(t, m))}</span><span class="m-tag">${esc(matchTag(t, m))}</span>${timerBtn}</div>
        <div class="${cls(m.home, h.known)} m-home">${esc(h.text)}</div>
        ${scoreInputs(t, m, names, readOnly)}
        <div class="${cls(m.away, a.known)} m-away">${esc(a.text)}</div>
        ${winnerSelect(t, m, names, readOnly)}
      </div>`;
  }

  function filteredMatches(t) {
    return t.matches
      .filter((m) => {
        if (ui.filter === 'ko' && m.phase !== 'ko') return false;
        if (ui.filter.startsWith('g') && !(m.phase === 'group' && m.group === +ui.filter.slice(1))) return false;
        if (ui.team !== 'all' && m.home !== ui.team && m.away !== ui.team) return false;
        if (ui.field !== 'all' && m.field !== +ui.field) return false;
        if (ui.openOnly && C.isPlayed(m)) return false;
        return true;
      })
      .sort((a, b) => a.start - b.start || a.field - b.field);
  }

  function rankingCard(t, names, big) {
    const ranking = C.finalRanking(t);
    if (!ranking) return '';
    const medal = ['gold', 'silver', 'bronze'];
    const top = ranking.filter((r) => r.place <= 3);
    const rest = ranking.filter((r) => r.place > 3);
    return `<section class="card podium-card${big ? ' podium-big' : ''}">
        <h2>Schlussrangliste</h2>
        <ol class="podium">
          ${top
            .map(
              (r) => `<li class="podium-${medal[r.place - 1] || 'rest'}"><span class="podium-place tabular">${r.place}.</span><span>${r.teams
                .map((id) => esc(names.get(id)))
                .join(' / ')}</span></li>`
            )
            .join('')}
        </ol>
        ${
          rest.length
            ? `<ol class="rest-ranking">${rest
                .map((r) => `<li><span class="tabular">${r.place}.</span> ${r.teams.map((id) => esc(names.get(id))).join(' / ')}</li>`)
                .join('')}</ol>`
            : ''
        }
      </section>`;
  }

  function renderSchedule(t) {
    const s = t.settings;
    const names = teamMap(t);

    if (t.stage === 'setup') {
      const p = C.previewTournament(t);
      if (p.errors.length) {
        return `<section class="card">
            <h2>Bereit zum Start?</h2>
            <div class="callout callout-warn"><strong>Bitte zuerst ergänzen:</strong><ul>${p.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>
          </section>`;
      }
      const fmtLabel = p.koMatches || s.format === 'ko' ? 'Ende (ca.)' : 'Ende Gruppenphase';
      return `<section class="card start-card">
          <h2>Bereit zum Start</h2>
          <dl class="stats">
            <div><dt>Spiele</dt><dd class="tabular">${p.matchCount}${p.koMatches ? ` <small>+ ${p.koMatches} Finalrunde</small>` : ''}</dd></div>
            <div><dt>Spielrunden</dt><dd class="tabular">${p.slots}</dd></div>
            <div><dt>Beginn</dt><dd class="tabular">${C.formatTime(p.start)}</dd></div>
            <div><dt>${fmtLabel}</dt><dd class="tabular">${C.formatTime(p.end)}</dd></div>
          </dl>
          <p class="hint">Gespielt wird auf ${s.fields} ${esc(s.fieldName)}${s.fields === 1 ? '' : 'ern'} gleichzeitig. Nach dem Start lassen sich Teams und Turnierform nicht mehr ändern, Zeiten schon.</p>
          <button type="button" class="btn btn-primary btn-large" data-action="start">Turnier starten</button>
        </section>`;
    }

    const filterOpts = [['all', 'Alle Spiele']];
    if (C.usesGroups(s)) {
      if (s.groupCount > 1) for (let g = 0; g < s.groupCount; g++) filterOpts.push(['g' + g, C.groupName(g)]);
      else filterOpts.push(['g0', 'Gruppenspiele']);
    }
    if (t.matches.some((m) => m.phase === 'ko')) filterOpts.push(['ko', finalsName(t)]);
    if (!filterOpts.some(([k]) => k === ui.filter)) ui.filter = 'all';
    if (ui.team !== 'all' && !names.has(ui.team)) ui.team = 'all';
    if (ui.field !== 'all' && +ui.field > s.fields) ui.field = 'all';

    const matches = filteredMatches(t);
    const slots = [];
    for (const m of matches) {
      const key = m.phase + ':' + m.start;
      if (!slots.length || slots[slots.length - 1].key !== key) slots.push({ key, start: m.start, phase: m.phase, items: [] });
      slots[slots.length - 1].items.push(m);
    }

    let stageAction = '';
    if (t.stage === 'groups' && C.hasFinals(s)) {
      stageAction = C.groupPhaseComplete(t)
        ? `<div class="callout callout-ok">Alle Gruppenspiele sind gespielt. <button type="button" class="btn btn-primary" data-action="start-ko">${esc(finalsName(t))} starten</button></div>`
        : '';
    }

    let lastPhase = null;
    let lastStart = null;
    const lunch = C.lunchWindow(s);
    const list = slots
      .map((slot) => {
        let divider = '';
        if (slot.phase !== lastPhase && lastPhase !== null) divider = `<h3 class="phase-divider">${esc(finalsName(t))}</h3>`;
        if (lunch && lastStart !== null && lastStart < lunch.from && slot.start >= lunch.to) {
          divider += `<div class="lunch-divider tabular">Mittagspause ${C.formatTime(lunch.from)}–${C.formatTime(lunch.to)}</div>`;
        }
        lastPhase = slot.phase;
        lastStart = slot.start;
        return `${divider}<div class="slot">
            <div class="slot-time tabular">${C.formatTime(slot.start)}</div>
            <div class="slot-matches">${slot.items.map((m) => matchRow(t, m, names, false)).join('')}</div>
          </div>`;
      })
      .join('');

    return `
      ${rankingCard(t, names)}
      ${stageAction}
      <section class="card">
        <div class="toolbar">
          <div class="toolbar-filters">
            <label class="sr-only" for="flt-phase">Spiele filtern</label>
            <select id="flt-phase" class="input input-compact" data-ui="filter">
              ${filterOpts.map(([k, l]) => `<option value="${k}"${ui.filter === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}
            </select>
            <label class="sr-only" for="flt-team">Team filtern</label>
            <select id="flt-team" class="input input-compact" data-ui="team">
              <option value="all">Alle Teams</option>
              ${t.teams.map((x) => `<option value="${esc(x.id)}"${ui.team === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select>
            ${
              s.fields > 1
                ? `<label class="sr-only" for="flt-field">${esc(s.fieldName)} filtern</label>
                   <select id="flt-field" class="input input-compact" data-ui="field">
                     <option value="all">Alle ${esc(s.fieldName)}er</option>
                     ${Array.from({ length: s.fields }, (_, i) => `<option value="${i + 1}"${String(ui.field) === String(i + 1) ? ' selected' : ''}>${esc(s.fieldName)} ${i + 1}</option>`).join('')}
                   </select>`
                : ''
            }
            <span class="check"><input id="flt-open" type="checkbox" data-ui="openOnly"${ui.openOnly ? ' checked' : ''}><label for="flt-open">Nur offene</label></span>
          </div>
          <div class="toolbar-actions">
            ${EMBEDDED ? '' : '<button type="button" class="btn btn-ghost" data-action="print">Drucken</button>'}
            ${t.stage === 'groups' && C.hasFinals(s) && !C.groupPhaseComplete(t) ? `<button type="button" class="btn btn-ghost" data-action="start-ko">${esc(finalsName(t))} vorzeitig starten</button>` : ''}
            ${t.stage === 'ko' && C.usesGroups(s) ? `<button type="button" class="btn btn-ghost" data-action="reset-ko">${esc(finalsName(t))} zurücksetzen</button>` : ''}
            <button type="button" class="btn btn-ghost btn-danger-text" data-action="reset">Turnier zurücksetzen</button>
          </div>
        </div>
        <div class="schedule">${list || '<p class="empty">Keine Spiele für diesen Filter.</p>'}</div>
      </section>`;
  }

  /* ------------------------------------------------------------------ */
  /* Tabellen                                                            */
  /* ------------------------------------------------------------------ */

  function standingsTable(t, rows, gi, names, compact) {
    const s = t.settings;
    const ko = s.format === 'groups_ko';
    const anyPlayed = rows.some((r) => r.played);
    return `<div class="table-wrap"><table class="standings${compact ? ' compact' : ''}">
        <thead><tr>
          <th scope="col" class="num">#</th><th scope="col">Team</th>
          <th scope="col" class="num" title="Spiele">Sp</th>
          ${compact ? '' : '<th scope="col" class="num" title="Siege">S</th><th scope="col" class="num" title="Unentschieden">U</th><th scope="col" class="num" title="Niederlagen">N</th>'}
          <th scope="col" class="num">${esc(s.scoreUnit)}</th><th scope="col" class="num" title="Differenz">+/−</th><th scope="col" class="num">Pkt</th>
        </tr></thead>
        <tbody>
          ${rows
            .map((r, i) => {
              const cls = ko ? (i < s.advancePerGroup ? 'q' : i === s.advancePerGroup && s.extraQualifiers > 0 ? 'q2' : '') : '';
              return `<tr class="${cls}">
                <td class="num tabular">${r.rank}${r.tied && anyPlayed ? '<span class="tie" title="Gleichstand nicht aufgelöst">=</span>' : ''}${r.byLot ? '<span class="lot" title="Durch Los entschieden">L</span>' : ''}</td>
                <td class="team-cell">${esc(names.get(r.id))}</td>
                <td class="num tabular">${r.played}</td>
                ${compact ? '' : `<td class="num tabular">${r.won}</td><td class="num tabular">${r.drawn}</td><td class="num tabular">${r.lost}</td>`}
                <td class="num tabular">${r.scored}:${r.conceded}</td>
                <td class="num tabular">${r.diff > 0 ? '+' : ''}${r.diff}</td>
                <td class="num tabular strong">${r.points}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table></div>`;
  }

  /** Hinweise und Knöpfe für Gleichstände, die nur das Los entscheiden kann. */
  function tieNotes(t, rows, names, gm) {
    if (!rows.some((r) => r.played)) return '';
    const locked = t.stage !== 'groups' || isReadOnly(t);
    const groups = new Map();
    rows.filter((r) => r.tied).forEach((r) => {
      if (!groups.has(r.tieGroup)) groups.set(r.tieGroup, []);
      groups.get(r.tieGroup).push(r.id);
    });
    const notes = [];
    for (const ids of groups.values()) {
      notes.push(`<div class="callout callout-warn tie-note">
          <span>Gleichstand: ${ids.map((id) => esc(names.get(id))).join(', ')}.${gm.every(C.isPlayed) ? '' : ' Es sind noch Spiele offen.'}</span>
          ${locked ? '' : `<button type="button" class="btn btn-small" data-action="draw-lot" data-ids="${esc(ids.join(','))}">Los ziehen</button>`}
        </div>`);
    }
    const lotted = rows.filter((r) => r.byLot).map((r) => r.id);
    if (lotted.length) {
      notes.push(`<div class="callout tie-note"><span>Durch Los entschieden (L): ${lotted.map((id) => esc(names.get(id))).join(' vor ')}.</span>
          ${locked ? '' : `<button type="button" class="btn btn-small btn-ghost" data-action="clear-lot" data-ids="${esc(lotted.join(','))}">Los aufheben</button>`}
        </div>`);
    }
    return notes.join('');
  }

  function renderTables(t) {
    const s = t.settings;
    if (t.stage === 'setup') {
      return '<section class="card"><p class="empty">Die Tabellen erscheinen, sobald das Turnier gestartet ist.</p></section>';
    }
    const names = teamMap(t);
    const tables = C.groupTables(t);
    const legend =
      s.format === 'groups_ko'
        ? `<p class="legend"><span class="sw sw-q"></span> weiter in die KO-Phase${s.extraQualifiers ? ' <span class="sw sw-q2"></span> Chance als beste Nächstplatzierte' : ''}</p>`
        : '';
    return `${rankingCard(t, names)}
      <div class="cols">
        ${tables
          .map((rows, gi) => {
            const gm = t.matches.filter((m) => m.phase === 'group' && m.group === gi);
            return `<section class="card">
                <h2>${s.groupCount > 1 ? esc(C.groupName(gi)) : 'Tabelle'} <span class="count">${gm.filter(C.isPlayed).length}/${gm.length}</span></h2>
                ${standingsTable(t, rows, gi, names, false)}
                ${tieNotes(t, rows, names, gm)}
              </section>`;
          })
          .join('')}
      </div>${legend}`;
  }

  /* ------------------------------------------------------------------ */
  /* KO-Phase                                                            */
  /* ------------------------------------------------------------------ */

  function bracketCard(t, m, names, readOnly) {
    const h = sideName(t, m, 'h', names);
    const a = sideName(t, m, 'a', names);
    const w = C.matchWinner(m);
    const timerOn = t.timer && t.timer.matchId === m.id;
    const line = (side, info, id) => {
      const val = side === 'h' ? m.scoreH : m.scoreA;
      const score = readOnly
        ? `<span class="b-score tabular">${C.isPlayed(m) ? val : ''}</span>`
        : `<input type="number" inputmode="numeric" min="0" max="999" class="score-input tabular" id="b${side}-${esc(m.id)}" data-key="b${side}-${esc(m.id)}" data-score="${side}" data-id="${esc(m.id)}" value="${val === null ? '' : esc(val)}" aria-label="${esc(t.settings.scoreUnit)} ${esc(info.text)}"${!m.home || !m.away || isReadOnly(t) ? ' disabled' : ''}>`;
      return `<div class="b-line${w && w === id ? ' is-winner' : ''}${info.known ? '' : ' is-tbd'}"><span class="b-name">${esc(info.text)}</span>${score}</div>`;
    };
    return `<div class="b-match${C.isPlayed(m) ? ' is-played' : ''}${timerOn ? ' is-timed' : ''}" data-match="${esc(m.id)}">
        <div class="b-meta tabular"><span>${C.formatTime(m.start)} · ${esc(fieldLabel(t, m))}</span>${
          readOnly
            ? ''
            : `<button type="button" class="timer-pick${timerOn ? ' is-on' : ''}" data-action="timer-select" data-id="${esc(m.id)}" aria-pressed="${!!timerOn}" title="Spieluhr für dieses Spiel">${CLOCK_ICON}<span>Uhr</span></button>`
        }</div>
        ${line('h', h, m.home)}${line('a', a, m.away)}
        ${winnerSelect(t, m, names, readOnly)}
      </div>`;
  }

  /** KO-Baum: Hauptbaum, Platzierungsbäume und einzelne Platzierungsspiele. */
  function bracket(t, names, readOnly) {
    const ko = t.matches.filter((m) => m.phase === 'ko').sort((a, b) => a.order - b.order);
    const brackets = new Map();
    for (const m of ko) {
      const key = m.bracket || 1;
      if (!brackets.has(key)) brackets.set(key, []);
      brackets.get(key).push(m);
    }
    const keys = [...brackets.keys()].sort((a, b) => a - b);
    const singles = [];
    const sections = [];
    for (const key of keys) {
      const ms = brackets.get(key);
      const roundsUsed = [...new Set(ms.map((m) => m.round))].sort((a, b) => a - b);
      if (ms.length === 1 && key !== 1) {
        singles.push(ms[0]);
        continue;
      }
      const firstRound = roundsUsed[0];
      const byes =
        key === 1
          ? ms
              .filter((m) => m.round === firstRound + 1)
              .flatMap((m) => [m.homeSrc, m.awaySrc])
              .filter((src) => src && src.team)
              .map((src) => names.get(src.team))
          : [];
      const title = key === 1 ? (t.settings.format === 'groups' ? 'Spiel um Platz 1' : 'Hauptrunde') : ms[0].bracketTitle;
      sections.push(`<div class="b-section">
          ${keys.length > 1 ? `<h3 class="b-title">${esc(title)}</h3>` : ''}
          <div class="bracket-wrap"><div class="bracket">
            ${roundsUsed
              .map((r, i) => {
                const roundMs = ms.filter((m) => m.round === r);
                return `<div class="b-round">
                  <h4>${esc(roundMs[0].roundName.replace(/^Platz \d+–\d+: /, ''))}</h4>
                  <div class="b-matches">${roundMs.map((m) => bracketCard(t, m, names, readOnly)).join('')}</div>
                  ${i === 0 && byes.length ? `<p class="hint">Freilos: ${byes.map(esc).join(', ')}</p>` : ''}
                </div>`;
              })
              .join('')}
          </div></div>
        </div>`);
    }
    if (singles.length) {
      sections.push(`<div class="b-section">
          <h3 class="b-title">Platzierungsspiele</h3>
          <div class="b-singles">${singles
            .map((m) => `<div class="b-single"><h4>${esc(m.label)}</h4>${bracketCard(t, m, names, readOnly)}</div>`)
            .join('')}</div>
        </div>`);
    }
    return sections.join('');
  }

  function renderKO(t) {
    const s = t.settings;
    const names = teamMap(t);
    const what = finalsName(t);
    if (t.stage === 'setup') {
      return `<section class="card"><p class="empty">${
        s.format === 'ko' ? 'Der KO-Baum entsteht beim Start des Turniers im Spielplan.' : `Die ${esc(what)} entstehen nach der Gruppenphase.`.replace('Die KO-Phase entstehen', 'Die KO-Phase entsteht')
      }</p></section>`;
    }
    if (t.stage === 'groups') {
      const done = C.groupPhaseComplete(t);
      let preview = [];
      try {
        preview = C.buildFinals(t).matches.filter((m) => m.homeSrc && m.homeSrc.team && m.awaySrc && m.awaySrc.team);
      } catch (e) {
        preview = [];
      }
      const tables = C.groupTables(t);
      const origin = (id) => {
        for (let g = 0; g < tables.length; g++) {
          const i = tables[g].findIndex((r) => r.id === id);
          if (i >= 0) return `${i + 1}. ${C.groupName(g)}`;
        }
        return '';
      };
      return `<section class="card">
          <h2>${done ? 'Erste Paarungen' : 'Zwischenstand: Paarungen nach aktuellem Stand'}</h2>
          <ul class="pair-list">
            ${preview
              .map(
                (m) => `<li><span class="muted pair-label">${esc(m.label)}</span>
                  <span>${esc(names.get(m.homeSrc.team))} <small class="muted">(${esc(origin(m.homeSrc.team))})</small></span>
                  <span class="muted">vs</span>
                  <span>${esc(names.get(m.awaySrc.team))} <small class="muted">(${esc(origin(m.awaySrc.team))})</small></span></li>`
              )
              .join('')}
          </ul>
          <p class="hint">${s.format === 'groups_ko' ? 'Gruppensieger mit der besten Bilanz pro Spiel erhalten bei Bedarf ein Freilos. Teams aus derselben Gruppe treffen in der ersten Runde nicht aufeinander.' : 'Die Gleichplatzierten aller Gruppen spielen um ihre Ränge.'}</p>
          <button type="button" class="btn btn-primary" data-action="start-ko">${esc(what)} ${done ? 'starten' : 'vorzeitig starten'}</button>
        </section>`;
    }
    return `${rankingCard(t, names)}
      <section class="card">
        <h2>${esc(s.format === 'groups' ? 'Finalrunde' : 'KO-Baum')}</h2>
        ${bracket(t, names, false)}
      </section>`;
  }

  /* ------------------------------------------------------------------ */
  /* Schiri-Ansicht: ein Feld, grosse Knöpfe, fürs Handy                 */
  /* ------------------------------------------------------------------ */

  function refereeMatch(t, field) {
    const list = t.matches.filter((m) => m.field === field).sort((a, b) => a.start - b.start);
    if (t.timer) {
      const timed = C.slotMatches(t, t.timer.matchId).find((m) => m.field === field);
      if (timed && !C.isPlayed(timed) && timed.home && timed.away) return { current: timed, list };
    }
    return { current: list.find((m) => !C.isPlayed(m) && m.home && m.away) || null, list };
  }

  function renderReferee(t) {
    const s = t.settings;
    const names = teamMap(t);
    const field = Math.min(Math.max(1, parseInt(ui.refField, 10) || 1), s.fields);
    const { current: m, list } = refereeMatch(t, field);
    const ro = isReadOnly(t);
    const fieldSelect =
      s.fields > 1
        ? `<div class="ref-field"><label class="field-label" for="ref-field">Ich pfeife auf</label>
             <select id="ref-field" class="input" data-ui="refField">${Array.from(
               { length: s.fields },
               (_, i) => `<option value="${i + 1}"${field === i + 1 ? ' selected' : ''}>${esc(s.fieldName)} ${i + 1}</option>`
             ).join('')}</select></div>`
        : '';
    const upcoming = list.filter((x) => !C.isPlayed(x) && x !== m).slice(0, 3);
    const recent = list.filter(C.isPlayed).slice(-2).reverse();
    const small = (x) => `<li><span class="tabular">${C.formatTime(x.start)}</span><span>${esc(sideName(t, x, 'h', names).text)} – ${esc(
      sideName(t, x, 'a', names).text
    )}</span>${C.isPlayed(x) ? `<strong class="tabular">${x.scoreH}:${x.scoreA}</strong>` : `<small class="muted">${esc(matchTag(t, x))}</small>`}</li>`;

    let main;
    if (!m) {
      main = `<section class="card ref-card"><p class="empty">Auf ${esc(s.fieldName)} ${field} steht im Moment kein Spiel an.${
        list.some((x) => !C.isPlayed(x)) ? ' Die nächsten Teams stehen noch nicht fest.' : ''
      }</p></section>`;
    } else {
      const draft = ui.refDrafts[m.id] || { h: 0, a: 0 };
      const hName = sideName(t, m, 'h', names).text;
      const aName = sideName(t, m, 'a', names).text;
      const inSlot = t.timer && C.slotMatches(t, t.timer.matchId).some((x) => x.id === m.id);
      const timer = inSlot
        ? `<div class="ref-timer phase-${t.timer.phase}">
             <div class="ref-timer-phase" data-timer-phase>${esc(C.timerPhaseLabel(t, Date.now()))}</div>
             <div class="ref-timer-clock tabular" data-timer-clock>${C.formatClock(C.timerRemaining(t.timer, Date.now()))}</div>
             <div class="ref-timer-flash" data-timer-flash hidden></div>
             ${ro ? '' : `<button type="button" class="btn ${t.timer.running ? '' : 'btn-primary'}" data-action="timer-toggle">${t.timer.running ? 'Pause' : C.timerElapsed(t.timer, Date.now()) > 0 ? 'Weiter' : 'Uhr starten'}</button>`}
           </div>`
        : ro
          ? ''
          : `<button type="button" class="btn ref-timer-pick" data-action="timer-select" data-id="${esc(m.id)}">${CLOCK_ICON} Spieluhr für dieses Spiel</button>`;
      const side = (key, name) => `<div class="ref-side">
          <div class="ref-name">${esc(name)}</div>
          <div class="ref-score tabular" aria-live="polite">${draft[key]}</div>
          ${
            ro
              ? ''
              : `<div class="ref-btns">
                   <button type="button" class="ref-btn ref-minus" data-action="ref-minus" data-side="${key}" data-id="${esc(m.id)}" aria-label="${esc(name)}: ein ${esc(s.scoreUnit)} weniger"${draft[key] === 0 ? ' disabled' : ''}>−</button>
                   <button type="button" class="ref-btn ref-plus" data-action="ref-plus" data-side="${key}" data-id="${esc(m.id)}" aria-label="${esc(name)}: ein ${esc(s.scoreUnit)} mehr">+</button>
                 </div>`
          }
        </div>`;
      const koDraw = m.phase === 'ko' && draft.h === draft.a;
      const save = ro
        ? ''
        : koDraw
          ? `<div class="ref-save"><p class="hint">Unentschieden. Wer gewinnt nach Penalty / Verlängerung?</p>
               <div class="btn-row"><button type="button" class="btn btn-primary" data-action="ref-save" data-id="${esc(m.id)}" data-winner-side="h">${esc(hName)}</button>
               <button type="button" class="btn btn-primary" data-action="ref-save" data-id="${esc(m.id)}" data-winner-side="a">${esc(aName)}</button></div></div>`
          : `<div class="ref-save"><button type="button" class="btn btn-primary btn-large" data-action="ref-save" data-id="${esc(m.id)}">Resultat ${draft.h}:${draft.a} speichern</button></div>`;
      main = `<section class="card ref-card" data-match="${esc(m.id)}">
          <div class="ref-meta"><span class="tabular">${C.formatTime(m.start)}</span> · ${esc(fieldLabel(t, m))} · ${esc(matchTag(t, m))}</div>
          ${timer}
          <div class="ref-board">${side('h', hName)}<div class="ref-colon">:</div>${side('a', aName)}</div>
          ${save}
          ${ro ? '<p class="hint">Nur Ansicht: Für Eingaben braucht es Bearbeitungsrechte.</p>' : '<p class="hint">Der Zwischenstand bleibt auf diesem Gerät gespeichert, bis du das Resultat speicherst.</p>'}
        </section>`;
    }
    return `${fieldSelect}${main}
      <div class="cols">
        <section class="card"><h2>Danach auf ${esc(s.fieldName)} ${field}</h2>${upcoming.length ? `<ul class="ref-list">${upcoming.map(small).join('')}</ul>` : '<p class="empty">Keine weiteren Spiele.</p>'}</section>
        ${recent.length ? `<section class="card"><h2>Zuletzt gespielt</h2><ul class="ref-list">${recent.map(small).join('')}</ul></section>` : ''}
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Beamer-Ansicht                                                      */
  /* ------------------------------------------------------------------ */

  function renderBeamer(t) {
    const s = t.settings;
    const names = teamMap(t);
    const sorted = t.matches.slice().sort((a, b) => a.start - b.start || a.field - b.field);
    const next = sorted.filter((m) => !C.isPlayed(m)).slice(0, Math.max(4, s.fields * 2));
    const recent = sorted.filter(C.isPlayed).slice(-4).reverse();
    const now = new Date();

    let main;
    if (t.stage === 'setup') {
      main = `<section class="bm-panel"><h2>Teams</h2><ul class="bm-teams">${t.teams.map((x) => `<li>${esc(x.name)}</li>`).join('')}</ul></section>`;
    } else if (t.stage === 'ko') {
      main = `${rankingCard(t, names, true)}<section class="bm-panel"><h2>KO-Phase</h2>${bracket(t, names, true)}</section>`;
    } else {
      main = `${rankingCard(t, names, true)}<div class="bm-tables">${C.groupTables(t)
        .map(
          (rows, gi) => `<section class="bm-panel"><h2>${s.groupCount > 1 ? esc(C.groupName(gi)) : 'Tabelle'}</h2>${standingsTable(t, rows, gi, names, true)}</section>`
        )
        .join('')}</div>`;
    }

    const matchList = (list) =>
      list.length
        ? `<ul class="bm-matches">${list
            .map((m) => {
              const h = sideName(t, m, 'h', names).text;
              const a = sideName(t, m, 'a', names).text;
              return `<li><span class="bm-when tabular">${C.formatTime(m.start)}<small>${esc(fieldLabel(t, m))}</small></span>
                <span class="bm-pair"><span>${esc(h)}</span>${
                  C.isPlayed(m) ? `<strong class="tabular">${m.scoreH}:${m.scoreA}</strong>` : '<span class="muted">vs</span>'
                }<span>${esc(a)}</span></span></li>`;
            })
            .join('')}</ul>`
        : '<p class="muted">Keine</p>';

    return `<div class="beamer">
        <header class="bm-head">
          <div><div class="bm-eyebrow">${esc(stageLabel(t))}</div><h1>${esc(t.name)}</h1></div>
          <div class="bm-right">
            <div class="bm-clock tabular" id="bm-clock">${C.formatTime(now.getHours() * 60 + now.getMinutes())}</div>
            ${BEAMER_WINDOW ? '' : '<button type="button" class="btn btn-ghost" data-action="beamer-exit">Beamer beenden</button>'}
          </div>
        </header>
        <div class="bm-grid">
          <aside class="bm-side">
            ${
              t.timer
                ? `<section class="bm-panel bm-timer phase-${t.timer.phase}">
                    <div class="bm-timer-phase" data-timer-phase>${esc(C.timerPhaseLabel(t, Date.now()))}</div>
                    <div class="bm-timer-clock tabular" data-timer-clock>${C.formatClock(C.timerRemaining(t.timer, Date.now()))}</div>
                    <div class="tb-progress"><span data-timer-bar></span></div>
                    <div class="bm-timer-flash" data-timer-flash hidden></div>
                    <ul class="bm-timer-matches">${C.slotMatches(t, t.timer.matchId)
                      .map(
                        (m) =>
                          `<li><small>${esc(fieldLabel(t, m))}</small><span>${esc(sideName(t, m, 'h', names).text)} – ${esc(sideName(t, m, 'a', names).text)}</span></li>`
                      )
                      .join('')}</ul>
                  </section>`
                : ''
            }
            <section class="bm-panel"><h2>Nächste Spiele</h2>${matchList(next)}</section>
            <section class="bm-panel"><h2>Letzte Resultate</h2>${matchList(recent)}</section>
          </aside>
          <div class="bm-main">${main}</div>
        </div>
      </div>`;
  }

  setInterval(() => {
    const el = document.getElementById('bm-clock');
    if (el) {
      const d = new Date();
      el.textContent = C.formatTime(d.getHours() * 60 + d.getMinutes());
    }
  }, 15000);

  /* ------------------------------------------------------------------ */
  /* Spieluhr                                                            */
  /* ------------------------------------------------------------------ */

  const CLIENT_ID = C.uid('c');
  let audioCtx = null;
  let wakeLock = null;
  let wakeLockTried = 0;
  let flash = { text: '', until: 0 };
  let prevTimer = null;
  let prevTimerTid = null;

  function ensureAudio() {
    if (ui.sound === false) return;
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    } catch (e) {
      audioCtx = null;
    }
  }

  // Tonfolgen: [Frequenz in Hz, Dauer in ms]
  const SOUNDS = {
    shift: [[880, 160]],
    halftime: [[660, 350], [660, 350]],
    end: [[523, 450], [523, 450], [392, 1000]],
    next: [[880, 200], [1175, 450]],
  };

  function playSound(name) {
    if (ui.sound === false || !audioCtx || audioCtx.state !== 'running') return;
    let at = audioCtx.currentTime + 0.02;
    for (const [freq, ms] of SOUNDS[name] || []) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.setValueAtTime(0.25, at + ms / 1000 - 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(at);
      osc.stop(at + ms / 1000 + 0.02);
      at += ms / 1000 + 0.12;
    }
  }

  function showFlash(text, ms) {
    flash = { text, until: Date.now() + (ms || 4000) };
  }

  /** Erkennt Signale (Wechsel, Halbzeit, Spielende, nächstes Spiel) auf jedem Gerät. */
  function detectSignals(t, now) {
    const tm = t.timer;
    const cur = tm
      ? {
          matchId: tm.matchId,
          phase: tm.phase,
          running: tm.running,
          halftimeDone: tm.halftimeDone,
          el: C.timerElapsed(tm, now),
          dur: tm.durationMs,
        }
      : null;
    const prev = prevTimerTid === t.id ? prevTimer : null;
    prevTimer = cur;
    prevTimerTid = t.id;
    if (!prev || !cur) {
      if (prev && !cur && prev.phase === 'break') {
        playSound('next');
        showFlash('Alle Spiele beendet');
      }
      return;
    }
    const s = t.settings;
    if (prev.matchId !== cur.matchId) {
      if (prev.phase === 'break') {
        playSound('next');
        showFlash('Nächstes Spiel bereitmachen');
      }
      return;
    }
    if (prev.phase === 'game' && cur.phase === 'break') {
      playSound('end');
      showFlash('Spielende · Wechselpause');
      return;
    }
    if (cur.phase === 'game' && prev.running && !cur.running && cur.el >= cur.dur) {
      playSound('end');
      showFlash('Spielende');
      return;
    }
    if (cur.phase === 'game' && !prev.halftimeDone && cur.halftimeDone) {
      playSound('halftime');
      showFlash('Halbzeit · Seitenwechsel', 6000);
      return;
    }
    if (cur.phase === 'game' && cur.running && s.shiftInterval > 0) {
      const step = s.shiftInterval * 60000;
      const a = Math.floor(prev.el / step);
      const b = Math.floor(cur.el / step);
      if (b > a && b > 0 && cur.el < cur.dur - 2000) {
        playSound('shift');
        showFlash('Wechsel!', 2500);
      }
    }
  }

  function updateTimerDisplays(t, now) {
    const tm = t.timer;
    if (!tm) return;
    const remaining = C.timerRemaining(tm, now);
    const clock = C.formatClock(remaining);
    const label = C.timerPhaseLabel(t, now);
    const pct = tm.durationMs ? Math.min(100, (C.timerElapsed(tm, now) / tm.durationMs) * 100) : 0;
    document.querySelectorAll('[data-timer-clock]').forEach((el) => {
      if (el.textContent !== clock) el.textContent = clock;
      el.classList.toggle('is-low', tm.phase === 'game' && tm.running && remaining <= 60000);
    });
    document.querySelectorAll('[data-timer-phase]').forEach((el) => {
      if (el.textContent !== label) el.textContent = label;
    });
    document.querySelectorAll('[data-timer-bar]').forEach((el) => {
      el.style.width = pct.toFixed(2) + '%';
    });
    const showing = flash.until > now;
    document.querySelectorAll('[data-timer-flash]').forEach((el) => {
      el.hidden = !showing;
      if (showing && el.textContent !== flash.text) el.textContent = flash.text;
    });
  }

  function manageWakeLock(t) {
    const want = ui.beamer || !!(t.timer && t.timer.running);
    if (want && !wakeLock && navigator.wakeLock && Date.now() - wakeLockTried > 30000 && document.visibilityState === 'visible') {
      wakeLockTried = Date.now();
      navigator.wakeLock
        .request('screen')
        .then((lock) => {
          wakeLock = lock;
          lock.addEventListener('release', () => {
            wakeLock = null;
          });
        })
        .catch(() => {});
    } else if (!want && wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  function tick() {
    const t = current();
    const now = Date.now();
    const tm = t.timer;
    if (tm && tm.running && !isReadOnly(t)) {
      const el = C.timerElapsed(tm, now);
      const overdue =
        el >= tm.durationMs + 3000 ||
        (tm.phase === 'game' && t.settings.timerHalves === 2 && !tm.halftimeDone && el >= tm.durationMs / 2 + 3000);
      const controller = !t.live || !tm.owner || tm.owner === CLIENT_ID || overdue;
      if (controller) {
        const events = C.timerTick(t, now);
        if (events.length) {
          if (t.timer) t.timer.owner = CLIENT_ID;
          save();
          pushLive(t);
          remoteRender();
        }
      }
    }
    detectSignals(t, now);
    updateTimerDisplays(t, now);
    manageWakeLock(t);
  }

  function timerMatchInfo(t, names) {
    const tm = t.timer;
    const ms = C.slotMatches(t, tm.matchId);
    const m = t.matches.find((x) => x.id === tm.matchId);
    if (!m) return '';
    const pair = (x) => `${esc(sideName(t, x, 'h', names).text)} – ${esc(sideName(t, x, 'a', names).text)}`;
    const others = ms.filter((x) => x.id !== m.id);
    return `<span class="tabular">${C.formatTime(m.start)}</span> · ${esc(fieldLabel(t, m))}: ${pair(m)}${
      others.length ? ` <span class="muted">(+ ${others.length} ${others.length === 1 ? 'Spiel' : 'Spiele'} gleichzeitig)</span>` : ''
    }`;
  }

  function renderTimerBar(t) {
    const tm = t.timer;
    if (!tm) return '';
    const names = teamMap(t);
    const now = Date.now();
    const ro = isReadOnly(t);
    const done = tm.phase === 'game' && !tm.running && C.timerElapsed(tm, now) >= tm.durationMs;
    const startLabel = tm.running ? 'Pause' : C.timerElapsed(tm, now) > 0 ? 'Weiter' : 'Start';
    const controls = ro
      ? ''
      : `${done ? '' : `<button type="button" class="btn ${tm.running ? '' : 'btn-primary'}" data-action="timer-toggle">${startLabel}</button>`}
         <button type="button" class="btn btn-ghost btn-small" data-action="timer-minus" title="Eine Minute weniger">−1′</button>
         <button type="button" class="btn btn-ghost btn-small" data-action="timer-plus" title="Eine Minute mehr">+1′</button>
         <button type="button" class="btn btn-ghost btn-small" data-action="timer-reset">Zurück auf Start</button>
         ${tm.phase === 'game' && t.settings.breakDuration > 0 ? '<button type="button" class="btn btn-ghost btn-small" data-action="timer-break">Wechselpause</button>' : ''}
         <button type="button" class="btn btn-ghost btn-small" data-action="timer-next">Nächstes Spiel</button>
         <button type="button" class="icon-btn" data-action="timer-close" aria-label="Spieluhr schliessen">✕</button>`;
    return `<div class="timer-bar phase-${tm.phase}${tm.running ? ' is-running' : ''}" role="region" aria-label="Spieluhr">
        <div class="tb-progress"><span data-timer-bar></span></div>
        <div class="tb-inner">
          <div class="tb-info">
            <div class="tb-phase" data-timer-phase>${esc(C.timerPhaseLabel(t, now))}</div>
            <div class="tb-match">${timerMatchInfo(t, names)}</div>
          </div>
          <div class="tb-clock tabular" data-timer-clock>${C.formatClock(C.timerRemaining(tm, now))}</div>
          <div class="tb-flash" data-timer-flash hidden></div>
          <div class="tb-controls">
            ${controls}
            <button type="button" class="btn btn-ghost btn-small" data-action="sound-toggle" aria-pressed="${ui.sound !== false}">${ui.sound !== false ? 'Ton an' : 'Ton aus'}</button>
          </div>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Live-Modus (Synchronisation über die Datenbank der Online-Seite)    */
  /* ------------------------------------------------------------------ */

  const live = {
    db: null,
    checked: false,
    list: [],
    listError: '',
    tid: null,
    unsubs: [],
    struct: null,
    results: new Map(),
    timerJson: null,
    lastStruct: null,
    lastResults: new Map(),
    lastTimer: null,
    readOnly: false,
    connected: false,
    error: '',
    chains: new Map(),
    inflight: 0,
    applyPending: false,
    loadTimer: null,
  };
  let pendingRender = false;

  function isReadOnly(t) {
    return !!(t && t.live && live.readOnly);
  }

  /** Neu zeichnen, ausser jemand tippt gerade (dann beim Verlassen des Feldes). */
  function remoteRender() {
    const a = document.activeElement;
    const editing =
      a && app.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox' && a.value !== a.defaultValue;
    if (editing && !ui.beamer) {
      pendingRender = true;
      return;
    }
    queueRender();
  }

  document.addEventListener('focusout', () => {
    if (!pendingRender) return;
    pendingRender = false;
    setTimeout(render, 0);
  });

  async function initLive() {
    if (!window.claude || typeof window.claude.use !== 'function') {
      live.checked = true;
      return;
    }
    let db = null;
    try {
      db = await window.claude.use('db');
    } catch (e) {
      db = null;
    }
    live.checked = true;
    if (!db) return remoteRender();
    live.db = db;
    try {
      db.collection('live')
        .limit(200)
        .onSnapshot(
          (snap) => {
            live.list = snap.docs
              .filter((d) => d.exists)
              .map((d) => {
                const x = d.data() || {};
                return { id: d.id, name: String(x.name || 'Turnier').slice(0, 80), updated: Number(x.updated) || 0 };
              });
            live.listError = '';
            remoteRender();
          },
          (err) => {
            live.listError = err && err.code;
            remoteRender();
          }
        );
    } catch (e) {
      live.listError = 'unavailable';
    }
    attachLive();
    remoteRender();
  }

  function detachLive() {
    live.unsubs.forEach((u) => {
      try {
        u();
      } catch (e) {
        /* egal */
      }
    });
    live.unsubs = [];
    clearTimeout(live.loadTimer);
    Object.assign(live, {
      tid: null,
      struct: null,
      results: new Map(),
      timerJson: null,
      lastStruct: null,
      lastResults: new Map(),
      lastTimer: null,
      readOnly: false,
      connected: false,
      error: '',
      seen: false,
    });
  }

  function attachLive() {
    if (!live.db) return;
    const t = current();
    const want = t.live ? t.id : null;
    if (want === live.tid) return;
    detachLive();
    if (!want) return;
    live.tid = want;
    const base = 'live/' + want;
    const onError = (err) => {
      live.error = (err && err.code) || 'unavailable';
      remoteRender();
    };
    live.loadTimer = setTimeout(() => {
      if (!live.connected) {
        live.error = 'timeout';
        remoteRender();
      }
    }, 10000);
    live.unsubs.push(
      live.db.doc(base).onSnapshot((snap) => {
        if (live.tid !== want) return;
        if (!snap.exists) {
          // Nur als beendet werten, wenn das Turnier schon einmal auf dem Server war
          if (live.seen && !snap.metadata.fromCache && !snap.metadata.hasPendingWrites) endedRemotely(want);
          return;
        }
        live.seen = true;
        if (!snap.metadata.fromCache) {
          live.connected = true;
          live.error = '';
          clearTimeout(live.loadTimer);
        }
        const d = snap.data() || {};
        if (typeof d.json === 'string') live.struct = d.json;
        applyRemote();
      }, onError)
    );
    live.unsubs.push(
      live.db
        .collection(base + '/results')
        .limit(1000)
        .onSnapshot((snap) => {
          if (live.tid !== want) return;
          const map = new Map();
          snap.docs.forEach((d) => {
            if (d.exists) map.set(d.id, d.data());
          });
          live.results = map;
          applyRemote();
        }, onError)
    );
    live.unsubs.push(
      live.db.doc(base + '/meta/timer').onSnapshot((snap) => {
        if (live.tid !== want) return;
        const d = snap.exists ? snap.data() || {} : {};
        live.timerJson = typeof d.json === 'string' ? d.json : null;
        applyRemote();
      }, onError)
    );
  }

  function endedRemotely(tid) {
    const t = store.tournaments[tid];
    if (!t) return;
    if (!t.teams.length && !t.matches.length) {
      delete store.tournaments[tid];
      if (store.activeId === tid) store.activeId = null;
    } else {
      t.live = false;
    }
    save();
    toast('Die Live-Übertragung dieses Turniers wurde beendet. Deine Kopie bleibt hier gespeichert.');
    detachLive();
    remoteRender();
  }

  function structOf(t) {
    const c = C.clone(t);
    delete c.timer;
    delete c.live;
    for (const m of c.matches) {
      m.scoreH = null;
      m.scoreA = null;
      m.winner = null;
      m.resultFor = null;
      if (m.phase === 'ko') {
        m.home = null;
        m.away = null;
      }
    }
    return JSON.stringify(c);
  }

  function resultJson(r) {
    return JSON.stringify({ h: r.h, a: r.a, w: r.w || null });
  }

  function resultsOf(t) {
    const map = new Map();
    for (const m of t.matches) {
      if (C.isPlayed(m)) map.set(m.id, resultJson({ h: m.scoreH, a: m.scoreA, w: m.winner }));
    }
    return map;
  }

  function timerOf(t) {
    return t.timer ? JSON.stringify(t.timer) : null;
  }

  /** Server-Stand (Struktur + Resultate + Uhr) in das lokale Turnier übernehmen. */
  function applyRemote() {
    const tid = live.tid;
    if (!tid || live.struct === null) return;
    if (live.inflight > 0) {
      live.applyPending = true;
      return;
    }
    let t;
    try {
      t = C.normalizeTournament(JSON.parse(live.struct));
    } catch (e) {
      return;
    }
    t.id = tid;
    t.live = true;
    const results = live.results;
    const valid = (r) => r && Number.isInteger(r.h) && Number.isInteger(r.a) && r.h >= 0 && r.a >= 0;
    for (const m of t.matches) {
      const r = results.get(m.id);
      if (m.phase === 'group' && valid(r)) {
        m.scoreH = r.h;
        m.scoreA = r.a;
      }
    }
    const ko = t.matches.filter((m) => m.phase === 'ko').sort((a, b) => a.order - b.order);
    for (const m of ko) {
      const r = results.get(m.id);
      if (!valid(r)) continue;
      C.resolveKO(t);
      if (!m.home || !m.away) continue;
      m.scoreH = r.h;
      m.scoreA = r.a;
      m.winner = r.w === m.home || r.w === m.away ? r.w : null;
      m.resultFor = [m.home, m.away];
    }
    C.resolveKO(t);
    try {
      t.timer = live.timerJson ? JSON.parse(live.timerJson) : null;
      if (t.timer && !t.matches.some((m) => m.id === t.timer.matchId)) t.timer = null;
    } catch (e) {
      t.timer = null;
    }
    const local = store.tournaments[tid];
    if (local) t.created = local.created;
    store.tournaments[tid] = t;
    live.lastStruct = structOf(t);
    const raw = new Map();
    for (const [id, r] of results) if (valid(r)) raw.set(id, resultJson(r));
    live.lastResults = raw;
    live.lastTimer = live.timerJson;
    save();
    remoteRender();
  }

  function liveWrite(path, op) {
    const prev = live.chains.get(path) || Promise.resolve();
    live.inflight++;
    const run = () => op(live.db.doc(path));
    const next = prev
      .then(run)
      .catch(
        (err) =>
          err && err.code === 'unavailable'
            ? new Promise((r) => setTimeout(r, 500 + Math.random() * 1000)).then(run)
            : Promise.reject(err)
      )
      .catch(handleLiveError)
      .then(() => {
        live.inflight--;
        if (live.inflight === 0 && live.applyPending) {
          live.applyPending = false;
          applyRemote();
        }
      });
    live.chains.set(path, next);
  }

  function handleLiveError(err) {
    const code = (err && err.code) || 'unavailable';
    if (code === 'invalid_argument') {
      if (!live.readOnly) {
        live.readOnly = true;
        toast('Dieses Live-Turnier kannst du nur ansehen. Zum Eintragen braucht es mindestens die Rolle «Mitwirkende».', 'error');
        live.applyPending = true;
        remoteRender();
      }
    } else if (code === 'quota_exceeded') {
      toast('Der Speicher für Live-Turniere ist voll. Beende alte Live-Turniere.', 'error');
    } else {
      toast('Live-Synchronisation gestört. Änderungen bleiben auf diesem Gerät.', 'error');
    }
  }

  /** Lokale Änderungen an den Server übertragen (nur was sich geändert hat). */
  function pushLive(t) {
    if (!live.db || !t.live || live.tid !== t.id || live.readOnly) return;
    const base = 'live/' + t.id;
    const struct = structOf(t);
    if (struct !== live.lastStruct) {
      live.lastStruct = struct;
      liveWrite(base, (ref) => ref.set({ name: t.name, updated: Date.now(), json: struct }));
    }
    const cur = resultsOf(t);
    for (const [id, json] of cur) {
      if (live.lastResults.get(id) !== json) {
        const body = JSON.parse(json);
        liveWrite(base + '/results/' + id, (ref) => ref.set(body));
      }
    }
    for (const id of live.lastResults.keys()) {
      if (!cur.has(id)) liveWrite(base + '/results/' + id, (ref) => ref.delete());
    }
    live.lastResults = cur;
    const tj = timerOf(t);
    if (tj !== live.lastTimer) {
      live.lastTimer = tj;
      liveWrite(base + '/meta/timer', (ref) => ref.set({ json: tj }));
    }
  }

  function goLive(t) {
    if (!live.db) return;
    t.live = true;
    save();
    attachLive();
    live.lastStruct = null;
    live.lastResults = new Map();
    live.lastTimer = '__none__';
    pushLive(t);
    render();
    toast('Das Turnier ist jetzt live. Teile die Seite, damit andere mitmachen können.', 'ok');
  }

  function stopLive(t) {
    if (!live.db || !t.live) return;
    const base = 'live/' + t.id;
    if (!live.readOnly) {
      for (const id of new Set([...live.lastResults.keys(), ...live.results.keys()])) {
        liveWrite(base + '/results/' + id, (ref) => ref.delete());
      }
      liveWrite(base + '/meta/timer', (ref) => ref.delete());
      liveWrite(base, (ref) => ref.delete());
    }
    t.live = false;
    save();
    detachLive();
    render();
  }

  function joinLive(id) {
    let t = store.tournaments[id];
    if (!t) {
      const entry = live.list.find((x) => x.id === id);
      t = C.normalizeTournament({ id, name: entry ? entry.name : 'Live-Turnier', live: true });
      store.tournaments[id] = t;
    }
    t.live = true;
    store.activeId = id;
    save();
    render();
  }

  function liveStatus(t) {
    if (!t.live) return '';
    let text = 'verbinde …';
    if (live.readOnly) text = 'nur Ansicht';
    else if (live.connected) text = 'synchronisiert';
    else if (live.error) text = 'keine Verbindung, Änderungen bleiben auf diesem Gerät';
    return `<span class="pill pill-live">Live</span><span class="meta-text">${esc(text)}</span>`;
  }

  /* ------------------------------------------------------------------ */
  /* Export / Import                                                     */
  /* ------------------------------------------------------------------ */

  function slug(name) {
    return (
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'turnier'
    );
  }

  let downloadsApi = null;
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude
      .use('downloads')
      .then((d) => {
        downloadsApi = d;
      })
      .catch(() => {});
  }

  function exportDialog(t) {
    const json = JSON.stringify(t, null, 2);
    const actions = [{ label: 'In Zwischenablage kopieren', value: 'copy', cmd: 'copy' }];
    if (!EMBEDDED || downloadsApi) actions.push({ label: 'Als Datei speichern', value: 'file', cmd: 'file' });
    actions.push({ label: 'Schliessen', value: 'null', kind: 'primary' });
    openModal({
      title: 'Turnier exportieren',
      body: `<p>Mit diesem Text lässt sich das Turnier auf einem anderen Gerät über «Import» wiederherstellen.</p>
             <label class="sr-only" for="export-text">Turnierdaten</label>
             <textarea id="export-text" class="input mono" rows="10" readonly>${esc(json)}</textarea>`,
      actions,
      onCommand(cmd, root) {
        const ta = root.querySelector('#export-text');
        if (cmd === 'copy') {
          const fallback = () => {
            ta.focus();
            ta.select();
            toast('Text ist markiert. Mit Strg+C bzw. Cmd+C kopieren.');
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json).then(() => toast('In die Zwischenablage kopiert.', 'ok'), fallback);
          } else fallback();
        } else if (cmd === 'file' && downloadsApi) {
          downloadsApi
            .save({ filename: slug(t.name) + '.json', data: json })
            .then(() => toast('Datei gespeichert.', 'ok'))
            .catch((err) => {
              if (err && err.code === 'declined') return;
              if (err && err.code === 'rate_limited') toast('Es ist schon ein Speicherdialog offen.');
              else toast('Speichern als Datei ist hier nicht möglich. Nutze «In Zwischenablage kopieren».', 'error');
            });
        } else if (cmd === 'file' && !EMBEDDED) {
          const blob = new Blob([json], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = slug(t.name) + '.json';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }
      },
    });
  }

  function importDialog() {
    openModal({
      title: 'Turnier importieren',
      body: `<label class="field-label" for="import-file">Datei wählen (.json)</label>
             <input id="import-file" type="file" accept="application/json,.json" class="input">
             <label class="field-label" for="import-text">oder exportierten Text einfügen</label>
             <textarea id="import-text" class="input mono" rows="8"></textarea>`,
      actions: [
        { label: 'Abbrechen', value: 'null' },
        { label: 'Importieren', value: 'ok', kind: 'primary' },
      ],
      collect: (root) => root.querySelector('#import-text').value,
    }).then((text) => {
      if (!text) return;
      try {
        const data = JSON.parse(text);
        const list = data && data.tournaments ? Object.values(data.tournaments) : [data];
        let last = null;
        for (const raw of list) {
          const t = C.normalizeTournament(raw);
          if (store.tournaments[t.id]) {
            t.id = C.uid('t');
            t.name += ' (Import)';
          }
          t.created = Date.now();
          t.live = false;
          store.tournaments[t.id] = t;
          last = t;
        }
        if (last) store.activeId = last.id;
        save();
        render();
        toast(list.length === 1 ? 'Turnier importiert.' : list.length + ' Turniere importiert.', 'ok');
      } catch (e) {
        toast('Import fehlgeschlagen: Der Text ist kein gültiges Turnier.', 'error');
      }
    });
    const file = modalRoot.querySelector('#import-file');
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        modalRoot.querySelector('#import-text').value = String(reader.result || '');
      };
      reader.readAsText(f);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Ereignisse                                                          */
  /* ------------------------------------------------------------------ */

  function addTeams(t, rawNames) {
    if (t.stage !== 'setup') throw new Error('Das Turnier läuft bereits.');
    const existing = new Set(t.teams.map((x) => x.name.toLowerCase()));
    let added = 0;
    let skipped = 0;
    for (const raw of rawNames) {
      const name = raw.trim().slice(0, 60);
      if (!name) continue;
      if (existing.has(name.toLowerCase())) {
        skipped++;
        continue;
      }
      existing.add(name.toLowerCase());
      t.teams.push({ id: C.uid('team'), name, group: null });
      added++;
    }
    if (C.usesGroups(t.settings)) C.fillUnassigned(t);
    if (skipped) toast(`${skipped} Team${skipped === 1 ? '' : 's'} übersprungen (Name schon vorhanden).`);
    return added;
  }

  function moveItem(list, index, delta) {
    const j = index + delta;
    if (index < 0 || j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
  }

  async function onClick(e) {
    ensureAudio();
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      ui.tab = tabBtn.dataset.tab;
      saveUi();
      render();
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const t = current();
    const id = btn.dataset.id;
    const key = btn.dataset.keyName;

    switch (btn.dataset.action) {
      case 'new': {
        const name = await promptDialog('Neues Turnier', 'Name des Turniers', 'Neues Turnier');
        if (!name) return;
        const nt = C.createTournament(name);
        store.tournaments[nt.id] = nt;
        store.activeId = nt.id;
        ui.tab = 'teams';
        save();
        render();
        return;
      }
      case 'duplicate': {
        const nt = C.createTournament(t.name + ' (Kopie)');
        nt.settings = C.clone(t.settings);
        nt.teams = t.teams.map((x) => ({ id: C.uid('team'), name: x.name, group: x.group }));
        store.tournaments[nt.id] = nt;
        store.activeId = nt.id;
        ui.tab = 'teams';
        save();
        render();
        toast('Kopie ohne Resultate erstellt.', 'ok');
        return;
      }
      case 'delete': {
        if (!(await confirmDialog('Turnier löschen?', `«${t.name}» wird mit allen Resultaten gelöscht.`, 'Löschen', true))) return;
        if (t.live) stopLive(t);
        delete store.tournaments[t.id];
        store.activeId = null;
        save();
        render();
        return;
      }
      case 'export':
        return exportDialog(t);
      case 'import':
        return importDialog();
      case 'beamer':
        ui.beamer = true;
        render();
        window.scrollTo(0, 0);
        try {
          if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        } catch (err) {
          /* Vollbild ist optional */
        }
        return;
      case 'beamer-exit':
        ui.beamer = false;
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
        } catch (err) {
          /* egal */
        }
        render();
        return;
      case 'print':
        window.print();
        return;
      case 'start':
        if (mutate((x) => C.startTournament(x))) {
          ui.tab = 'schedule';
          ui.filter = 'all';
          ui.team = 'all';
          saveUi();
          render();
          toast('Turnier gestartet. Viel Spass!', 'ok');
        }
        return;
      case 'start-ko': {
        const force = !C.groupPhaseComplete(t);
        if (force && !(await confirmDialog(finalsName(t) + ' vorzeitig starten?', 'Es sind noch nicht alle Gruppenspiele gespielt. Die Paarungen richten sich nach dem aktuellen Stand, offene Gruppenspiele werden gesperrt.', 'Trotzdem starten'))) return;
        if (mutate((x) => C.startKO(x, { force }))) {
          ui.tab = 'ko';
          saveUi();
          render();
        }
        return;
      }
      case 'reset-ko':
        if (!(await confirmDialog(finalsName(t) + ' zurücksetzen?', 'Alle Spiele nach der Gruppenphase und deren Resultate werden gelöscht. Die Gruppenresultate bleiben erhalten.', 'Zurücksetzen', true))) return;
        mutate((x) => C.resetKO(x));
        return;
      case 'reset':
        if (!(await confirmDialog('Turnier zurücksetzen?', 'Der Spielplan und alle Resultate werden gelöscht. Teams und Einstellungen bleiben erhalten.', 'Zurücksetzen', true))) return;
        mutate((x) => C.resetTournament(x));
        return;
      case 'undo':
        undo();
        return;
      case 'ref-plus':
      case 'ref-minus': {
        const d = Object.assign({ h: 0, a: 0 }, ui.refDrafts[id]);
        const side = btn.dataset.side === 'a' ? 'a' : 'h';
        d[side] = Math.max(0, Math.min(999, d[side] + (btn.dataset.action === 'ref-plus' ? 1 : -1)));
        ui.refDrafts[id] = d;
        saveUi();
        render();
        return;
      }
      case 'ref-save': {
        const d = Object.assign({ h: 0, a: 0 }, ui.refDrafts[id]);
        const m = t.matches.find((x) => x.id === id);
        if (!m) return;
        const ws = btn.dataset.winnerSide;
        const winner = ws === 'h' ? m.home : ws === 'a' ? m.away : null;
        const label = `${teamMap(t).get(m.home)} – ${teamMap(t).get(m.away)} ${d.h}:${d.a}`;
        if (mutate((x) => C.setResult(x, id, d.h, d.a, winner), { label: 'Resultat ' + label })) {
          delete ui.refDrafts[id];
          saveUi();
          render();
          toast('Gespeichert: ' + label, 'ok');
        }
        return;
      }
      case 'timer-select':
        mutate((x) => {
          if (x.timer && x.timer.matchId === id) return;
          if (x.timer) C.timerPause(x.timer, Date.now());
          x.timer = C.createTimer(x, id, CLIENT_ID);
        }, NO_UNDO);
        return;
      case 'timer-toggle':
        mutate((x) => {
          if (!x.timer) return;
          if (x.timer.running) C.timerPause(x.timer, Date.now());
          else C.timerStart(x.timer, Date.now(), CLIENT_ID);
        }, NO_UNDO);
        return;
      case 'timer-plus':
      case 'timer-minus':
        mutate((x) => x.timer && C.timerAdjust(x.timer, Date.now(), btn.dataset.action === 'timer-plus' ? 60000 : -60000), NO_UNDO);
        return;
      case 'timer-reset':
        mutate((x) => {
          if (x.timer) x.timer = C.createTimer(x, x.timer.matchId, CLIENT_ID);
        }, NO_UNDO);
        return;
      case 'timer-break':
        mutate((x) => {
          if (!x.timer) return;
          C.timerBreak(x, Date.now());
          x.timer.owner = CLIENT_ID;
        }, NO_UNDO);
        return;
      case 'timer-next':
        mutate((x) => C.timerNext(x, CLIENT_ID), NO_UNDO);
        if (!current().timer) toast('Es gibt kein weiteres Spiel.');
        return;
      case 'timer-close':
        mutate((x) => {
          x.timer = null;
        }, NO_UNDO);
        return;
      case 'sound-toggle':
        ui.sound = ui.sound === false;
        saveUi();
        ensureAudio();
        if (ui.sound) playSound('shift');
        render();
        return;
      case 'draw-lot':
      case 'clear-lot': {
        const ids = (btn.dataset.ids || '').split(',').filter(Boolean);
        mutate((x) => {
          if (x.stage !== 'groups') throw new Error('Die Gruppenphase ist abgeschlossen.');
          if (btn.dataset.action === 'draw-lot') C.drawLots(x, ids);
          else C.clearLots(x, ids);
        });
        if (btn.dataset.action === 'draw-lot') toast('Los gezogen.', 'ok');
        return;
      }
      case 'clear-lunch':
        mutate((x) => {
          x.settings.lunchStart = '';
          if (x.stage !== 'setup') C.scheduleAll(x);
        });
        return;
      case 'live-start':
        goLive(t);
        return;
      case 'live-stop':
        if (!(await confirmDialog('Live-Übertragung beenden?', 'Das Turnier wird von allen anderen Geräten entfernt. Auf diesem Gerät bleibt es gespeichert.', 'Beenden', true))) return;
        stopLive(t);
        return;
      case 'draw-groups':
        mutate((x) => C.drawGroups(x));
        toast('Gruppen neu ausgelost.', 'ok');
        return;
      case 'shuffle-teams':
        mutate((x) => {
          x.teams = C.shuffle(x.teams);
        });
        return;
      case 'clear-teams':
        if (!(await confirmDialog('Alle Teams entfernen?', 'Die Teamliste wird geleert.', 'Entfernen', true))) return;
        mutate((x) => {
          x.teams = [];
        });
        return;
      case 'team-del':
        mutate((x) => {
          if (x.stage !== 'setup') throw new Error('Das Turnier läuft bereits.');
          x.teams = x.teams.filter((team) => team.id !== id);
        });
        return;
      case 'team-up':
      case 'team-down':
        mutate((x) => moveItem(x.teams, x.teams.findIndex((team) => team.id === id), btn.dataset.action === 'team-up' ? -1 : 1));
        return;
      case 'tb-up':
      case 'tb-down':
      case 'tb-remove':
      case 'tb-add':
        mutate((x) => {
          if (isLocked(x, 'tiebreakers')) throw new Error('Während der KO-Phase gesperrt.');
          const list = x.settings.tiebreakers;
          const i = list.indexOf(key);
          if (btn.dataset.action === 'tb-up') moveItem(list, i, -1);
          if (btn.dataset.action === 'tb-down') moveItem(list, i, 1);
          if (btn.dataset.action === 'tb-remove' && list.length > 1) list.splice(i, 1);
          if (btn.dataset.action === 'tb-add' && i < 0) list.push(key);
        });
        return;
      default:
        return;
    }
  }

  function readScore(container, side) {
    const el = container.querySelector(`[data-score="${side}"]`);
    return el ? el.value.trim() : '';
  }

  function onChange(e) {
    const el = e.target;
    if (el.closest('#modal-root')) return;

    if (el.dataset.change === 'switch') {
      if (el.value.startsWith('live:')) return joinLive(el.value.slice(5));
      store.activeId = el.value;
      save();
      render();
      return;
    }
    if (el.dataset.ui) {
      ui[el.dataset.ui] = el.type === 'checkbox' ? el.checked : el.value;
      saveUi();
      render();
      return;
    }
    if (el.dataset.field === 'name') {
      const name = el.value.trim();
      if (!name) {
        toast('Der Turniername darf nicht leer sein.', 'error');
        return render();
      }
      mutate((t) => {
        t.name = name.slice(0, 80);
      }, { defer: true });
      return;
    }
    if (el.dataset.setting) {
      const key = el.dataset.setting;
      mutate(
        (t) => {
          if (isLocked(t, key)) throw new Error('Diese Einstellung ist gesperrt, solange das Turnier läuft.');
          const before = t.settings[key];
          t.settings[key] = el.type === 'checkbox' ? el.checked : el.value;
          t.settings = C.normalizeSettings(t.settings);
          if (String(before) !== String(t.settings[key]) && String(el.value) !== String(t.settings[key]) && el.type === 'number') {
            toast(`Wert angepasst auf ${t.settings[key]}.`);
          }
          if (key === 'groupCount' && t.stage === 'setup') {
            t.teams.forEach((team) => {
              if (Number.isInteger(team.group) && team.group >= t.settings.groupCount) team.group = null;
            });
            C.fillUnassigned(t);
          }
          if (t.stage !== 'setup' && C.SCHEDULE_KEYS.includes(key)) C.scheduleAll(t);
        },
        { defer: true }
      );
      return;
    }
    if (el.dataset.teamName) {
      const name = el.value.trim().slice(0, 60);
      mutate(
        (t) => {
          if (!name) throw new Error('Der Teamname darf nicht leer sein.');
          if (t.teams.some((x) => x.id !== el.dataset.teamName && x.name.toLowerCase() === name.toLowerCase())) {
            throw new Error(`Es gibt bereits ein Team «${name}».`);
          }
          const team = t.teams.find((x) => x.id === el.dataset.teamName);
          if (team) team.name = name;
        },
        { defer: true }
      );
      return;
    }
    if (el.dataset.teamGroup) {
      mutate((t) => {
        if (t.stage !== 'setup') throw new Error('Das Turnier läuft bereits.');
        const team = t.teams.find((x) => x.id === el.dataset.teamGroup);
        if (team) team.group = el.value === '' ? null : parseInt(el.value, 10);
      });
      return;
    }
    if (el.dataset.score) {
      const box = el.closest('[data-match]');
      const h = readScore(box, 'h');
      const a = readScore(box, 'a');
      if ((h === '') !== (a === '')) {
        box.classList.add('is-partial');
        return; // auf das zweite Resultat warten
      }
      const names = teamMap(current());
      const mm = current().matches.find((x) => x.id === el.dataset.id);
      mutate((t) => {
        const m = t.matches.find((x) => x.id === el.dataset.id);
        C.setResult(t, el.dataset.id, h, a, m && m.winner);
      }, { defer: true, label: mm ? `Resultat ${names.get(mm.home) || '?'} – ${names.get(mm.away) || '?'}` : 'Resultat' });
      return;
    }
    if (el.dataset.winner) {
      mutate((t) => {
        const m = t.matches.find((x) => x.id === el.dataset.winner);
        C.setResult(t, m.id, m.scoreH, m.scoreA, el.value || null);
      });
    }
  }

  function onSubmit(e) {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    if (form.dataset.form === 'add-team') {
      const input = form.querySelector('[name="name"]');
      const name = input.value.trim();
      if (!name) return;
      let added = 0;
      mutate((t) => {
        added = addTeams(t, [name]);
      });
      if (added) {
        const fresh = app.querySelector('#new-team');
        if (fresh) {
          fresh.value = '';
          fresh.focus();
        }
      }
    } else if (form.dataset.form === 'bulk-add') {
      const text = form.querySelector('[name="names"]').value;
      let added = 0;
      mutate((t) => {
        added = addTeams(t, text.split(/\r?\n|;/));
      });
      if (added) toast(`${added} Team${added === 1 ? '' : 's'} hinzugefügt.`, 'ok');
    }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || modalState || ui.beamer) return;
      e.preventDefault();
      undo();
      return;
    }
    if (e.key !== 'Escape') return;
    if (modalState) closeModal(null);
    else if (ui.beamer && !BEAMER_WINDOW) {
      ui.beamer = false;
      try {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      } catch (err) {
        /* egal */
      }
      render();
    }
  });
  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY) {
      store = loadStore();
      render();
    }
  });

  render();
  setInterval(tick, 200);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wakeLockTried = 0;
  });
  initLive();

  // Offline-Fähigkeit für die eigene Website (z. B. GitHub Pages)
  if (!EMBEDDED && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
