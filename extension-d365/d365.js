// Content script sur D365 F&O : panneau flottant (Shadow DOM) et pré-remplissage, matière par matière.
// Lit et écrit uniquement l'écran : aucune requête réseau, aucune requête interne D365 rejouée.
// L'utilisateur enregistre / valide toujours lui-même dans D365.
'use strict';

(() => {
  if (window.top !== window) return; // fenêtre principale uniquement

  const ORDER_SCAN_RE = /\bCC\d{11}\b/g;
  const WRITE_PAUSE_MS = 400;
  const VERIFY_DELAY_MS = 1000;
  const SCAN_DEBOUNCE_MS = 1000;

  // Les 21 champs du formulaire, dans l'ordre d'écriture
  const FIELDS = [
    { key: 'matiere', label: 'Matières', kind: 'text' },
    { key: 'epaisseur', label: 'Epaisseur', kind: 'text' },
    ...FD.BOUNDS.map((b) => ({ key: String(b), label: `Longueur (DEV${b})`, kind: 'number' })),
  ];

  // Dernière borne avec une longueur > 0 (null si aucune)
  function lastBound(group) {
    const used = FD.BOUNDS.filter((b) => group.lengths[String(b)] > 0);
    return used.length ? used[used.length - 1] : null;
  }

  // Champs à saisir : Matières, Epaisseur, puis les DEV jusqu'à la dernière borne utilisée.
  // Les DEV suivants ne sont ni cherchés ni écrits (gain de temps).
  function fieldsToFill(group) {
    const last = lastBound(group);
    return FIELDS.filter((f) => f.kind === 'text' || (last !== null && Number(f.key) <= last));
  }

  // ---------- Outils DOM D365 ----------

  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[\s ]+/g, ' ')
      .replace(/\s*\*\s*$/, '') // astérisque « obligatoire »
      .trim()
      .toLowerCase();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const rects = el.getClientRects();
    if (!rects.length) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  function isEditable(el) {
    return !(
      el.disabled ||
      el.readOnly ||
      el.getAttribute('aria-readonly') === 'true' ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.closest('[aria-disabled="true"]')
    );
  }

  function isLookup(el) {
    if (el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-haspopup')) return true;
    if (el.tagName === 'SELECT') return true;
    const box = el.closest('[class*="lookup" i], [data-dyn-role*="Lookup" i], [data-dyn-role*="ComboBox" i]');
    return Boolean(box);
  }

  // Champ de saisie associé à un libellé (label for=, aria-label, aria-labelledby)
  function findCandidates(labelText) {
    const target = norm(labelText);
    const found = new Set();
    for (const lab of document.querySelectorAll('label')) {
      if (norm(lab.textContent) !== target) continue;
      const id = lab.getAttribute('for');
      let input = id ? document.getElementById(id) : null;
      if (input && !/^(INPUT|TEXTAREA|SELECT)$/.test(input.tagName)) input = input.querySelector('input, textarea, select');
      if (!input) input = lab.querySelector('input, textarea, select');
      if (!input) {
        const box = lab.closest('[data-dyn-role], .field, div');
        input = box ? box.querySelector('input, textarea, select') : null;
      }
      if (input) found.add(input);
    }
    for (const el of document.querySelectorAll('input[aria-label], textarea[aria-label], select[aria-label]')) {
      if (norm(el.getAttribute('aria-label')) === target) found.add(el);
    }
    for (const el of document.querySelectorAll('input[aria-labelledby], textarea[aria-labelledby], select[aria-labelledby]')) {
      const txt = el
        .getAttribute('aria-labelledby')
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => n.textContent)
        .join(' ');
      if (norm(txt) === target) found.add(el);
    }
    return [...found];
  }

  // Résultat : { el, state: 'OK' | 'ABSENT' | 'MASQUÉ' | 'VERROUILLÉ' | 'AMBIGU', lookup, value }
  function inspectField(field) {
    const all = findCandidates(field.label);
    if (!all.length) return { field, el: null, state: 'ABSENT', count: 0 };
    const visible = all.filter(isVisible);
    if (!visible.length) return { field, el: all[0], state: 'MASQUÉ', count: all.length, value: all[0].value };
    if (visible.length > 1) return { field, el: null, state: 'AMBIGU', count: visible.length };
    const el = visible[0];
    return {
      field,
      el,
      state: isEditable(el) ? 'OK' : 'VERROUILLÉ',
      count: all.length,
      lookup: isLookup(el),
      value: el.value,
    };
  }

  // N° de commande affiché : d'abord dans les titres / légendes, sinon dans toute la page.
  function detectOrder() {
    const collect = (texts) => {
      const set = new Set();
      for (const t of texts) for (const m of String(t).matchAll(ORDER_SCAN_RE)) set.add(m[0]);
      return [...set];
    };
    const captions = [...document.querySelectorAll('[class*="caption" i], [class*="title" i], h1, h2')]
      .filter(isVisible)
      .map((e) => e.textContent);
    let found = collect(captions);
    let where = 'titre';
    if (found.length !== 1) {
      const inputs = [...document.querySelectorAll('input')].filter(isVisible).map((i) => i.value);
      found = collect([document.body ? document.body.innerText : '', ...inputs]);
      where = 'page';
    }
    if (found.length === 1) return { status: 'OK', orderNumber: found[0], where, all: found };
    if (found.length === 0) return { status: 'AUCUN', orderNumber: null, where, all: found };
    return { status: 'AMBIGU', orderNumber: null, where, all: found };
  }

  const nativeValueSetter = (el) => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, 'value').set;
  };

  async function writeField(el, value) {
    el.focus();
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    nativeValueSetter(el).call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await sleep(WRITE_PAUSE_MS);
  }

  function parseNumber(s) {
    const t = String(s || '').replace(/[\s  ]/g, '');
    if (t === '') return NaN;
    // « 1.234,50 » ou « 1234,50 » ou « 1234.50 »
    const cleaned = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
    return Number(cleaned);
  }

  function valueMatches(field, shown, expected) {
    if (field.kind === 'number') {
      const n = parseNumber(shown);
      return Number.isFinite(n) && Math.abs(n - expected) < 0.005;
    }
    return norm(shown) === norm(expected);
  }

  function expectedValue(group, field) {
    if (field.key === 'matiere') return group.matiere;
    if (field.key === 'epaisseur') return group.epaisseur;
    return group.lengths[field.key];
  }

  // ---------- État ----------

  const state = {
    orders: {},
    selectedOrder: null,
    selectedMaterial: null,
    detected: { status: 'AUCUN', orderNumber: null, all: [] },
    busy: false,
    open: false,
    userPickedOrder: false,
  };

  // ---------- Panneau (Shadow DOM, sans innerHTML) ----------

  const host = document.createElement('div');
  host.id = 'faconote-d365-host';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000; right: 16px; bottom: 16px;';
  const root = host.attachShadow({ mode: 'closed' });
  // Le clavier dans le panneau ne doit pas déclencher les raccourcis D365
  for (const t of ['keydown', 'keyup', 'keypress']) host.addEventListener(t, (e) => e.stopPropagation());

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; font-size: 12px; }
    .fab { border: 0; border-radius: 20px; padding: 8px 14px; font-weight: 700; color: #fff;
           background: #00478a; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
    .fab.todo { background: #c62828; }
    .panel { position: absolute; right: 0; bottom: 44px; width: 380px; max-height: 75vh; overflow: auto;
             background: #fff; color: #222; border: 1px solid #c8c8c8; border-radius: 8px;
             box-shadow: 0 6px 24px rgba(0,0,0,.25); padding: 10px; }
    .hidden { display: none; }
    .row { display: flex; gap: 6px; align-items: center; margin: 6px 0; flex-wrap: wrap; }
    h3 { margin: 0 0 6px; font-size: 13px; color: #00478a; }
    .muted { color: #666; }
    .ok { color: #1b5e20; } .ko { color: #b71c1c; } .warn { color: #8a5a00; }
    select, button.b { padding: 4px 8px; border: 1px solid #b0b0b0; border-radius: 4px; background: #fff; cursor: pointer; }
    button.b.primary { background: #00478a; color: #fff; border-color: #00478a; }
    button.b.danger { color: #b71c1c; border-color: #e0a0a0; }
    button.b:disabled { opacity: .45; cursor: default; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { padding: 4px 6px; border-radius: 4px; cursor: pointer; display: flex; justify-content: space-between; gap: 8px; }
    li.sel { background: #e3eefa; }
    li .tag { font-weight: 700; } li .tag.done { color: #1b5e20; } li .tag.todo { color: #c62828; }
    table { border-collapse: collapse; width: 100%; margin-top: 4px; }
    td, th { border-bottom: 1px solid #eee; padding: 2px 4px; text-align: left; }
    td.num { text-align: right; font-family: Consolas, monospace; }
    .msg { margin-top: 8px; padding: 6px; border-radius: 4px; white-space: pre-wrap; }
    .msg.ok { background: #e8f5e9; } .msg.ko { background: #ffebee; } .msg.warn { background: #fff8e1; }
    pre { margin: 6px 0 0; padding: 6px; background: #f5f5f5; border-radius: 4px; white-space: pre-wrap;
          font-family: Consolas, monospace; font-size: 11px; max-height: 260px; overflow: auto; }
  `;
  root.appendChild(style);

  const el = (tag, props = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c) n.appendChild(c);
    return n;
  };

  const fab = el('button', { class: 'fab', text: 'Façonote', title: 'Façonote → D365' });
  const panel = el('div', { class: 'panel hidden' });
  root.append(panel, fab);
  fab.addEventListener('click', () => {
    state.open = !state.open;
    panel.classList.toggle('hidden', !state.open);
    if (state.open) render();
  });

  let message = null; // { kind: 'ok'|'ko'|'warn', text }
  let diagnostic = null; // texte de « Lire l'écran »

  function setMessage(kind, text) {
    message = { kind, text };
    render();
  }

  const currentOrder = () => (state.selectedOrder ? state.orders[state.selectedOrder] : null);
  const currentGroup = () => {
    const o = currentOrder();
    return o ? o.groups.find((g) => g.material === state.selectedMaterial) || null : null;
  };

  function pickDefaults() {
    const nums = Object.keys(state.orders);
    // Présélection : la commande affichée dans D365, sinon le dernier choix, sinon la plus récente
    if (!state.userPickedOrder && state.detected.orderNumber && state.orders[state.detected.orderNumber]) {
      state.selectedOrder = state.detected.orderNumber;
    }
    if (!state.selectedOrder || !state.orders[state.selectedOrder]) {
      const recent = nums.sort((a, b) =>
        String(state.orders[b].receivedAt).localeCompare(String(state.orders[a].receivedAt))
      );
      state.selectedOrder = recent[0] || null;
    }
    const o = currentOrder();
    if (o && !o.groups.some((g) => g.material === state.selectedMaterial)) {
      const todo = o.groups.find((g) => !g.done);
      state.selectedMaterial = (todo || o.groups[0]).material;
    }
  }

  function updateFab() {
    const o = state.detected.orderNumber ? state.orders[state.detected.orderNumber] : null;
    const remaining = o ? o.groups.filter((g) => !g.done).length : 0;
    fab.classList.toggle('todo', remaining > 0);
    fab.textContent = remaining > 0 ? `Façonote · ${remaining} à faire` : 'Façonote';
  }

  function render() {
    updateFab();
    if (!state.open) return;
    pickDefaults();
    panel.replaceChildren();

    panel.appendChild(el('h3', { text: 'Façonote → D365' }));

    const d = state.detected;
    const detLine =
      d.status === 'OK'
        ? el('div', { class: 'ok', text: `Commande affichée : ${d.orderNumber}` })
        : d.status === 'AMBIGU'
        ? el('div', { class: 'warn', text: `Commande affichée ambiguë : ${d.all.join(', ')}` })
        : el('div', { class: 'muted', text: 'Aucune commande CC… détectée à l’écran.' });
    panel.appendChild(detLine);

    const nums = Object.keys(state.orders).sort((a, b) =>
      String(state.orders[b].receivedAt).localeCompare(String(state.orders[a].receivedAt))
    );
    if (!nums.length) {
      panel.appendChild(
        el('p', { class: 'muted', text: 'Aucune commande reçue. Dans Façonote : saisir le n° de commande puis « Envoyer vers l’extension ».' })
      );
    } else {
      const sel = el('select', {
        onchange: (e) => {
          state.selectedOrder = e.target.value;
          state.selectedMaterial = null;
          state.userPickedOrder = true;
          render();
        },
      });
      for (const n of nums) {
        const o = state.orders[n];
        const left = o.groups.filter((g) => !g.done).length;
        const opt = el('option', { value: n, text: `${n} — ${left ? `${left} à faire` : 'terminée'}` });
        if (n === state.selectedOrder) opt.selected = true;
        sel.appendChild(opt);
      }
      panel.appendChild(el('div', { class: 'row' }, [el('span', { text: 'Commande :' }), sel]));

      const o = currentOrder();
      if (o) {
        const when = o.sentAt ? new Date(o.sentAt).toLocaleString('fr-BE') : '?';
        panel.appendChild(el('div', { class: 'muted', text: `Envoyée depuis Façonote le ${when}` }));
        if (d.status === 'OK' && d.orderNumber !== o.orderNumber) {
          panel.appendChild(el('div', { class: 'warn', text: 'Attention : ce n° n’est pas la commande affichée dans D365.' }));
        }

        const ul = el('ul');
        for (const g of o.groups) {
          const li = el(
            'li',
            {
              class: g.material === state.selectedMaterial ? 'sel' : '',
              onclick: () => {
                state.selectedMaterial = g.material;
                render();
              },
            },
            [
              el('span', { text: `${g.material} → ${g.matiere} / ${g.epaisseur}` }),
              el('span', { class: `tag ${g.done ? 'done' : 'todo'}`, text: g.done ? 'fait ✓' : 'à faire' }),
            ]
          );
          ul.appendChild(li);
        }
        panel.appendChild(ul);

        const g = currentGroup();
        if (g) {
          const nonZero = FD.BOUNDS.filter((b) => g.lengths[String(b)] > 0);
          const table = el('table', {}, [
            el('tr', {}, [el('th', { text: 'Champ' }), el('th', { text: 'Longueur (m)' })]),
          ]);
          if (!nonZero.length) {
            table.appendChild(el('tr', {}, [el('td', { text: 'Toutes les longueurs sont à 0.' }), el('td')]));
          }
          for (const b of nonZero) {
            table.appendChild(
              el('tr', {}, [el('td', { text: `DEV${b}` }), el('td', { class: 'num', text: FD.formatD365(g.lengths[String(b)]) })])
            );
          }
          panel.appendChild(table);
          const last = lastBound(g);
          panel.appendChild(
            el('div', {
              class: 'muted',
              text: last
                ? `Saisie de Matières, Epaisseur et DEV100 à DEV${last} (les DEV à 0 jusque-là sont mis à 0,00). Les DEV suivants ne sont pas touchés.`
                : 'Saisie de Matières et Epaisseur seulement.',
            })
          );
        }
      }
    }

    const has = Boolean(currentGroup());
    const buttons = el('div', { class: 'row' }, [
      el('button', { class: 'b primary', text: 'Pré-remplir', onclick: onFill, ...(state.busy || !has ? { disabled: '' } : {}) }),
      el('button', {
        class: 'b',
        text: currentGroup() && currentGroup().done ? 'Marquer à faire' : 'Marquer fait',
        onclick: onToggleDone,
        ...(state.busy || !has ? { disabled: '' } : {}),
      }),
      el('button', { class: 'b', text: 'Lire l’écran', onclick: onReadScreen, ...(state.busy ? { disabled: '' } : {}) }),
      el('button', {
        class: 'b danger',
        text: 'Supprimer',
        title: 'Retirer cette commande de l’extension',
        onclick: onDelete,
        ...(state.busy || !currentOrder() ? { disabled: '' } : {}),
      }),
    ]);
    panel.appendChild(buttons);

    if (message) panel.appendChild(el('div', { class: `msg ${message.kind}`, text: message.text }));
    if (diagnostic) panel.appendChild(el('pre', { text: diagnostic }));
  }

  // ---------- Actions ----------

  async function updateGroup(orderNumber, material, patch) {
    const orders = await FD.loadOrders();
    const o = orders[orderNumber];
    if (!o) return false;
    const g = o.groups.find((x) => x.material === material);
    if (!g) return false;
    Object.assign(g, patch);
    await FD.saveOrders(orders);
    state.orders = orders;
    return true;
  }

  async function onToggleDone() {
    const o = currentOrder();
    const g = currentGroup();
    if (!o || !g) return;
    try {
      const done = !g.done;
      await updateGroup(o.orderNumber, g.material, { done, doneAt: done ? new Date().toISOString() : null });
      setMessage('ok', `${g.material} marquée ${done ? 'faite' : 'à faire'}.`);
    } catch (err) {
      setMessage('ko', errorText(err));
    }
  }

  async function onDelete() {
    const o = currentOrder();
    if (!o) return;
    if (!window.confirm(`Retirer la commande ${o.orderNumber} de l’extension ?\n(Rien n’est modifié dans D365 ni dans Façonote.)`)) return;
    try {
      const orders = await FD.loadOrders();
      delete orders[o.orderNumber];
      await FD.saveOrders(orders);
      state.orders = orders;
      state.selectedOrder = null;
      state.selectedMaterial = null;
      state.userPickedOrder = false;
      setMessage('ok', `Commande ${o.orderNumber} retirée de l’extension.`);
    } catch (err) {
      setMessage('ko', errorText(err));
    }
  }

  function onReadScreen() {
    const d = detectOrder();
    state.detected = d;
    const lines = [];
    lines.push(
      d.status === 'OK'
        ? `N° commande détecté : ${d.orderNumber} (trouvé dans : ${d.where})`
        : d.status === 'AMBIGU'
        ? `N° commande AMBIGU : ${d.all.join(', ')}`
        : 'N° commande : aucun CC + 11 chiffres trouvé'
    );
    lines.push('');
    let ok = 0;
    for (const f of FIELDS) {
      const r = inspectField(f);
      if (r.state === 'OK') ok++;
      let info = r.state;
      if (r.el) {
        const tag = r.el.tagName.toLowerCase();
        info += ` · <${tag}${r.el.type ? ` type=${r.el.type}` : ''}>`;
        if (r.lookup) info += ' · LISTE / LOOKUP';
        if (r.value !== undefined) info += ` · valeur « ${r.value} »`;
      }
      if (r.count > 1) info += ` · ${r.count} trouvés`;
      lines.push(`${f.label} : ${info}`);
    }
    lines.push('');
    lines.push(`${ok} / ${FIELDS.length} champs prêts.`);
    diagnostic = lines.join('\n');
    message = ok === FIELDS.length ? { kind: 'ok', text: 'Tous les champs sont prêts.' } : { kind: 'warn', text: 'Certains champs ne sont pas prêts (voir le détail).' };
    render();
  }

  function errorText(err) {
    const msg = err && err.message ? err.message : String(err);
    return /context invalidated/i.test(msg) ? 'Extension rechargée : actualisez la page D365 (F5).' : `Erreur : ${msg}`;
  }

  async function onFill() {
    const o = currentOrder();
    const g = currentGroup();
    if (!o || !g || state.busy) return;
    diagnostic = null;

    // 1. Le n° affiché doit être exactement celui de la commande choisie
    const d = detectOrder();
    state.detected = d;
    if (d.status !== 'OK') {
      setMessage('ko', d.status === 'AMBIGU'
        ? `Refusé : plusieurs n° de commande à l’écran (${d.all.join(', ')}). Ouvrez la commande ${o.orderNumber} seule.`
        : `Refusé : aucun n° de commande détecté à l’écran. Ouvrez la commande ${o.orderNumber}.`);
      return;
    }
    if (d.orderNumber !== o.orderNumber) {
      setMessage('ko', `Refusé : D365 affiche ${d.orderNumber}, mais la commande choisie est ${o.orderNumber}.`);
      return;
    }

    // 2. Les champs à saisir doivent exister, être visibles et modifiables AVANT toute écriture
    const toFill = fieldsToFill(g);
    const problems = [];
    for (const f of toFill) {
      const r = inspectField(f);
      if (r.state !== 'OK') problems.push(`${f.label} : ${r.state}`);
    }
    if (problems.length) {
      setMessage(
        'ko',
        `Rien n’a été écrit. Champs non prêts :\n${problems.join('\n')}\n\n` +
          'Ouvrez la section qui contient « Matières », « Epaisseur » et les longueurs DEV, ' +
          'passez la commande en mode Modifier, puis réessayez. « Lire l’écran » donne le détail.'
      );
      return;
    }

    state.busy = true;
    setMessage('warn', `Saisie de ${g.material} en cours… Ne touchez pas à la page.`);
    try {
      // 3. Écriture champ par champ, en re-cherchant chaque champ (D365 redessine le DOM)
      // Un champ qui affiche déjà la bonne valeur n'est pas réécrit (pas de pause).
      let written = 0;
      for (const f of toFill) {
        const now = detectOrder();
        if (now.orderNumber !== o.orderNumber) throw new Error('la commande affichée a changé pendant la saisie. Arrêt.');
        const r = inspectField(f);
        if (r.state !== 'OK') throw new Error(`${f.label} n’est plus modifiable (${r.state}). Arrêt.`);
        const v = expectedValue(g, f);
        if (valueMatches(f, r.el.value, v)) continue;
        await writeField(r.el, f.kind === 'number' ? FD.formatD365(v) : v);
        written++;
      }

      // 5. Relecture
      if (written) await sleep(VERIFY_DELAY_MS);
      const mismatches = [];
      for (const f of toFill) {
        const r = inspectField(f);
        const expected = expectedValue(g, f);
        const shown = r.el ? r.el.value : undefined;
        if (!r.el || !valueMatches(f, shown, expected)) {
          mismatches.push(`${f.label} : attendu « ${f.kind === 'number' ? FD.formatD365(expected) : expected} », lu « ${shown === undefined ? '—' : shown} »`);
        }
      }
      // DEV après la dernière borne : simple lecture. Une valeur non nulle déjà présente est signalée.
      for (const f of FIELDS) {
        if (toFill.includes(f)) continue;
        const r = inspectField(f);
        if (!r.el) continue;
        const n = parseNumber(r.el.value);
        if (Number.isFinite(n) && n !== 0) {
          mismatches.push(`${f.label} : contient « ${r.el.value} », Façonote attend 0 (non modifié, à corriger à la main)`);
        }
      }
      if (mismatches.length) {
        state.busy = false;
        setMessage('ko', `Saisie incomplète : ${g.material} reste « à faire ».\n${mismatches.join('\n')}\n\nVérifiez dans D365 avant d’enregistrer.`);
        return;
      }

      await updateGroup(o.orderNumber, g.material, { done: true, doneAt: new Date().toISOString() });
      const next = state.orders[o.orderNumber].groups.find((x) => !x.done);
      if (next) state.selectedMaterial = next.material;
      state.busy = false;
      setMessage(
        'ok',
        `${g.material} saisie et relue : OK (${written} champ${written > 1 ? 's' : ''} écrit${written > 1 ? 's' : ''}).\nVérifiez puis enregistrez vous-même dans D365.` +
          (next ? `\nMatière suivante : ${next.material}.` : '\nToutes les matières de la commande sont faites.')
      );
    } catch (err) {
      state.busy = false;
      setMessage('ko', `${errorText(err)}\n${g.material} reste « à faire ». Vérifiez les champs dans D365.`);
    }
  }

  // ---------- Chargement, stockage, détection SPA ----------

  async function refreshOrders() {
    try {
      state.orders = await FD.loadOrders();
    } catch (err) {
      message = { kind: 'ko', text: errorText(err) };
    }
    render();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[FD.STORAGE_KEY] && !state.busy) refreshOrders();
  });

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (state.busy) return;
      const before = state.detected.orderNumber;
      state.detected = detectOrder();
      if (state.detected.orderNumber !== before) {
        state.userPickedOrder = false;
        render();
      } else {
        updateFab();
      }
    }, SCAN_DEBOUNCE_MS);
  }

  function start() {
    // Hors de <body> : le panneau n'entre ni dans la détection du n° de commande, ni dans l'observer
    document.documentElement.appendChild(host);
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true, characterData: true });
    scheduleScan();
    refreshOrders();
  }

  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });
})();
