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
  let ui = Object.assign({ tab: 'teams', filter: 'all', team: 'all', openOnly: false }, loadUi());
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
      const { tab, filter, team, openOnly } = ui;
      localStorage.setItem(UI_KEY, JSON.stringify({ tab, filter, team, openOnly }));
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
    try {
      fn(t);
    } catch (e) {
      toast(e.message, 'error');
      queueRender();
      return false;
    }
    C.resolveKO(t);
    save();
    if (opts && opts.defer) queueRender();
    else render();
    return true;
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

  function stageLabel(t) {
    if (C.isFinished(t)) return 'Abgeschlossen';
    return { setup: 'Vorbereitung', groups: 'Gruppenphase', ko: 'KO-Phase' }[t.stage];
  }

  function toast(text, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.textContent = text;
    toastRoot.appendChild(el);
    setTimeout(() => el.classList.add('toast-out'), 3600);
    setTimeout(() => el.remove(), 4000);
  }

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
    if (C.usesKO(s)) tabs.push(['ko', 'KO-Phase']);
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
    app.innerHTML = ui.beamer ? renderBeamer(t) : renderMain(t);

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
    const prog = C.progress(t);
    const pct = prog.total ? Math.round((prog.played / prog.total) * 100) : 0;

    const content = {
      teams: renderTeams,
      settings: renderSettings,
      schedule: renderSchedule,
      tables: renderTables,
      ko: renderKO,
    }[ui.tab](t);

    return `
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">${LOGO}<span>TournamentBuilder</span></div>
          <div class="switcher">
            <label class="sr-only" for="tour-select">Turnier wählen</label>
            <select id="tour-select" class="input input-compact" data-change="switch">
              ${list.map((x) => `<option value="${esc(x.id)}"${x.id === t.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select>
          </div>
          <div class="top-actions">
            <button type="button" class="btn btn-ghost" data-action="new">Neu</button>
            <button type="button" class="btn btn-ghost" data-action="duplicate" title="Teams und Einstellungen übernehmen, ohne Resultate">Kopie</button>
            <button type="button" class="btn btn-ghost" data-action="export">Export</button>
            <button type="button" class="btn btn-ghost" data-action="import">Import</button>
            <button type="button" class="btn btn-ghost" data-action="delete">Löschen</button>
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
        <footer class="foot">Alle Daten bleiben in diesem Browser gespeichert. Für einen anderen Computer: Export und Import.</footer>
      </div>`;
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
    ko: ['advancePerGroup', 'extraQualifiers', 'thirdPlace'],
    ranking: ['pointsWin', 'pointsDraw', 'pointsLoss', 'tiebreakers'],
  };

  function isLocked(t, key) {
    if (LOCKS.structure.includes(key)) return t.stage !== 'setup';
    if (LOCKS.ko.includes(key)) return t.stage === 'ko' || (t.settings.format === 'ko' && t.stage !== 'setup');
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
          C.usesKO(s)
            ? `<section class="card">
                <h2>KO-Phase</h2>
                <div class="form-grid">
                  ${s.format === 'groups_ko' ? numField(t, 'advancePerGroup', 'Weiter pro Gruppe', 1, 32) : ''}
                  ${s.format === 'groups_ko' ? numField(t, 'extraQualifiers', 'Zusätzlich beste Nächstplatzierte', 0, 26, 'Z. B. die 2 besten Gruppendritten. Verglichen wird pro Spiel.') : ''}
                  <div class="field field-check">
                    <input id="set-thirdPlace" type="checkbox" data-setting="thirdPlace"${s.thirdPlace ? ' checked' : ''}${isLocked(t, 'thirdPlace') ? ' disabled' : ''}>
                    <label for="set-thirdPlace">Spiel um Platz 3</label>
                  </div>
                </div>
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
            ${s.format === 'groups_ko' ? numField(t, 'koBreak', 'Pause vor KO-Phase (Min.)', 0, 600) : ''}
          </div>
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
    const locked = (m.phase === 'group' && t.stage !== 'groups') || !m.home || !m.away;
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
    return `<div class="match${played ? ' is-played' : ''}" data-match="${esc(m.id)}">
        <div class="m-meta"><span class="m-field">${esc(fieldLabel(t, m))}</span><span class="m-tag">${esc(matchTag(t, m))}</span></div>
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
          ranking.length > 3
            ? `<p class="hint">${ranking
                .filter((r) => r.place > 3)
                .map((r) => `${r.place}. ${r.teams.map((id) => esc(names.get(id))).join(' / ')}`)
                .join(' · ')}</p>`
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
      const fmtLabel = s.format === 'ko' ? 'Ende KO-Phase' : 'Ende Gruppenphase';
      return `<section class="card start-card">
          <h2>Bereit zum Start</h2>
          <dl class="stats">
            <div><dt>Spiele</dt><dd class="tabular">${p.matchCount}${p.koMatches ? ` <small>+ ${p.koMatches} KO</small>` : ''}</dd></div>
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
    if (t.matches.some((m) => m.phase === 'ko')) filterOpts.push(['ko', 'KO-Phase']);
    if (!filterOpts.some(([k]) => k === ui.filter)) ui.filter = 'all';
    if (ui.team !== 'all' && !names.has(ui.team)) ui.team = 'all';

    const matches = filteredMatches(t);
    const slots = [];
    for (const m of matches) {
      const key = m.phase + ':' + m.start;
      if (!slots.length || slots[slots.length - 1].key !== key) slots.push({ key, start: m.start, phase: m.phase, items: [] });
      slots[slots.length - 1].items.push(m);
    }

    let stageAction = '';
    if (t.stage === 'groups' && s.format === 'groups_ko') {
      stageAction = C.groupPhaseComplete(t)
        ? `<div class="callout callout-ok">Alle Gruppenspiele sind gespielt. <button type="button" class="btn btn-primary" data-action="start-ko">KO-Phase starten</button></div>`
        : '';
    }

    let lastPhase = null;
    const list = slots
      .map((slot) => {
        let divider = '';
        if (slot.phase !== lastPhase && lastPhase !== null) divider = '<h3 class="phase-divider">KO-Phase</h3>';
        lastPhase = slot.phase;
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
            <span class="check"><input id="flt-open" type="checkbox" data-ui="openOnly"${ui.openOnly ? ' checked' : ''}><label for="flt-open">Nur offene</label></span>
          </div>
          <div class="toolbar-actions">
            ${EMBEDDED ? '' : '<button type="button" class="btn btn-ghost" data-action="print">Drucken</button>'}
            ${t.stage === 'groups' && s.format === 'groups_ko' && !C.groupPhaseComplete(t) ? '<button type="button" class="btn btn-ghost" data-action="start-ko">KO-Phase vorzeitig starten</button>' : ''}
            ${t.stage === 'ko' && s.format === 'groups_ko' ? '<button type="button" class="btn btn-ghost" data-action="reset-ko">KO-Phase zurücksetzen</button>' : ''}
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
                <td class="num tabular">${r.rank}${r.tied && anyPlayed ? '<span class="tie" title="Gleichstand nicht aufgelöst">=</span>' : ''}</td>
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
              </section>`;
          })
          .join('')}
      </div>${legend}`;
  }

  /* ------------------------------------------------------------------ */
  /* KO-Phase                                                            */
  /* ------------------------------------------------------------------ */

  function bracket(t, names, readOnly) {
    const ko = t.matches.filter((m) => m.phase === 'ko').sort((a, b) => a.order - b.order);
    const rounds = [];
    for (const m of ko) {
      if (m.thirdPlace) continue;
      (rounds[m.round] = rounds[m.round] || []).push(m);
    }
    const third = ko.find((m) => m.thirdPlace);
    const byes = ko
      .filter((m) => m.round === 1)
      .flatMap((m) => [m.homeSrc, m.awaySrc])
      .filter((src) => src && src.team)
      .map((src) => names.get(src.team));

    const card = (m) => {
      const h = sideName(t, m, 'h', names);
      const a = sideName(t, m, 'a', names);
      const w = C.matchWinner(m);
      const line = (side, info, id) => {
        const val = side === 'h' ? m.scoreH : m.scoreA;
        const score = readOnly
          ? `<span class="b-score tabular">${C.isPlayed(m) ? val : ''}</span>`
          : `<input type="number" inputmode="numeric" min="0" max="999" class="score-input tabular" id="b${side}-${esc(m.id)}" data-key="b${side}-${esc(m.id)}" data-score="${side}" data-id="${esc(m.id)}" value="${val === null ? '' : esc(val)}" aria-label="${esc(t.settings.scoreUnit)} ${esc(info.text)}"${!m.home || !m.away ? ' disabled' : ''}>`;
        return `<div class="b-line${w && w === id ? ' is-winner' : ''}${info.known ? '' : ' is-tbd'}"><span class="b-name">${esc(info.text)}</span>${score}</div>`;
      };
      return `<div class="b-match${C.isPlayed(m) ? ' is-played' : ''}" data-match="${esc(m.id)}">
          <div class="b-meta tabular">${C.formatTime(m.start)} · ${esc(fieldLabel(t, m))}</div>
          ${line('h', h, m.home)}${line('a', a, m.away)}
          ${winnerSelect(t, m, names, readOnly)}
        </div>`;
    };

    return `<div class="bracket-wrap"><div class="bracket">
        ${rounds
          .map(
            (ms, r) => `<div class="b-round">
              <h3>${esc(ms[0].roundName)}</h3>
              <div class="b-matches">${ms.map(card).join('')}</div>
              ${r === 0 && byes.length ? `<p class="hint">Freilos: ${byes.map(esc).join(', ')}</p>` : ''}
            </div>`
          )
          .join('')}
        ${third ? `<div class="b-round b-third"><h3>Spiel um Platz 3</h3><div class="b-matches">${card(third)}</div></div>` : ''}
      </div></div>`;
  }

  function renderKO(t) {
    const s = t.settings;
    const names = teamMap(t);
    if (t.stage === 'setup') {
      return `<section class="card"><p class="empty">${
        s.format === 'ko' ? 'Der KO-Baum entsteht beim Start des Turniers im Spielplan.' : 'Der KO-Baum entsteht nach der Gruppenphase.'
      }</p></section>`;
    }
    if (t.stage === 'groups') {
      const entries = C.koEntries(t);
      const tables = C.groupTables(t);
      const rankOf = (id, g) => tables[g].findIndex((r) => r.id === id) + 1;
      const done = C.groupPhaseComplete(t);
      return `<section class="card">
          <h2>${done ? 'Qualifiziert für die KO-Phase' : 'Zwischenstand: aktuell qualifiziert'}</h2>
          <ol class="seed-list">
            ${entries
              .map((e) => `<li><span>${esc(names.get(e.team))}</span><span class="muted">${rankOf(e.team, e.group)}. ${esc(C.groupName(e.group))}</span></li>`)
              .join('')}
          </ol>
          <p class="hint">Die Reihenfolge ist die Setzliste. Gruppensieger mit der besten Bilanz pro Spiel erhalten bei Bedarf ein Freilos.</p>
          <button type="button" class="btn btn-primary" data-action="start-ko">${done ? 'KO-Phase starten' : 'KO-Phase vorzeitig starten'}</button>
        </section>`;
    }
    return `${rankingCard(t, names)}
      <section class="card card-flush">
        <div class="card-head"><h2>KO-Baum</h2></div>
        ${bracket(t, names, false)}
      </section>`;
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

  function exportDialog(t) {
    const json = JSON.stringify(t, null, 2);
    const actions = [{ label: 'In Zwischenablage kopieren', value: 'copy', cmd: 'copy' }];
    if (!EMBEDDED) actions.push({ label: 'Als Datei speichern', value: 'file', cmd: 'file' });
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
        } else if (cmd === 'file') {
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
        if (force && !(await confirmDialog('KO-Phase vorzeitig starten?', 'Es sind noch nicht alle Gruppenspiele gespielt. Die Qualifikation richtet sich nach dem aktuellen Stand, offene Gruppenspiele werden gesperrt.', 'Trotzdem starten'))) return;
        if (mutate((x) => C.startKO(x, { force }))) {
          ui.tab = 'ko';
          saveUi();
          render();
        }
        return;
      }
      case 'reset-ko':
        if (!(await confirmDialog('KO-Phase zurücksetzen?', 'Alle KO-Spiele und deren Resultate werden gelöscht. Die Gruppenresultate bleiben erhalten.', 'Zurücksetzen', true))) return;
        mutate((x) => C.resetKO(x));
        return;
      case 'reset':
        if (!(await confirmDialog('Turnier zurücksetzen?', 'Der Spielplan und alle Resultate werden gelöscht. Teams und Einstellungen bleiben erhalten.', 'Zurücksetzen', true))) return;
        mutate((x) => C.resetTournament(x));
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
      mutate((t) => {
        const m = t.matches.find((x) => x.id === el.dataset.id);
        C.setResult(t, el.dataset.id, h, a, m && m.winner);
      }, { defer: true });
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
})();
