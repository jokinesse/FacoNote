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

  // Grille Nomenclature (fenêtre « Application mobile pour les pointages production »), relevée par le
  // diagnostic 0.3.9 sur le vrai D365. Seule la ligne active a un champ Quantité modifiable.
  const BOM_DIALOG_SEL = 'div[role="dialog"][data-dyn-form-name="FZAppMobileProdTracking"]';
  const BOM_GRID_SEL = '[role="grid"][aria-label="Nomenclature de production"]';
  const BOM_LIST_FORM_SEL = '[data-dyn-form-name="ProdTableListPage"]';
  const QTY_INPUT_SEL = 'input[aria-label="Quantité"]';
  const CODE_CELL_RE = /^(AR-?\d{1,8}|CHUTE|TEMPS_PROD)$/i;
  const ACTIVATE_POLL_MS = 50;
  const ACTIVATE_TRIES = 30; // 30 x 50 ms : 1,5 s au plus par méthode pour qu'une ligne devienne modifiable
  const MAX_KEY_STEPS = 40; // flèches clavier : nombre de pas au plus
  // Méthodes d'activation d'une ligne, essayées dans cet ordre (la dernière qui a marché passe en premier)
  const ACTIVATION_METHODS = ['souris sur Quantité', 'souris sur la ligne', 'clavier'];
  const SCROLL_PAUSE_MS = 150; // grille virtualisée : temps laissé à D365 pour dessiner les lignes après défilement
  const MAX_SCROLL_STEPS = 60;

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

  // ---------- Grille Nomenclature (bobines) ----------

  // Fenêtre Nomenclature ouverte avec sa grille visible, sinon null
  function findBom() {
    for (const dialog of document.querySelectorAll(BOM_DIALOG_SEL)) {
      if (!isVisible(dialog)) continue;
      const grid = [...dialog.querySelectorAll(BOM_GRID_SEL)].find(isVisible);
      if (grid) return { dialog, grid };
    }
    return null;
  }

  // N° CC de la page derrière la fenêtre : libellé du formulaire « Ordres de fabrication (liste) »,
  // puis champ « Commande vente ». Le contenu de la fenêtre elle-même n'est pas lu.
  function detectBomOrder(dialog) {
    const set = new Set();
    let where = 'liste des OF';
    for (const f of document.querySelectorAll(BOM_LIST_FORM_SEL)) {
      if (dialog && dialog.contains(f)) continue;
      for (const m of String(f.getAttribute('aria-label') || '').matchAll(ORDER_SCAN_RE)) set.add(m[0]);
    }
    if (!set.size) {
      where = 'champ Commande vente';
      for (const inp of findCandidates('Commande vente')) {
        if (dialog && dialog.contains(inp)) continue;
        for (const m of String(inp.value || '').matchAll(ORDER_SCAN_RE)) set.add(m[0]);
      }
    }
    const found = [...set];
    if (found.length === 1) return { status: 'OK', orderNumber: found[0], where, all: found };
    if (found.length === 0) return { status: 'AUCUN', orderNumber: null, where, all: found };
    return { status: 'AMBIGU', orderNumber: null, where, all: found };
  }

  function cellText(cell) {
    const f = cell.querySelector('input, textarea, select');
    if (f) return f.value;
    return cell.innerText !== undefined ? cell.innerText : cell.textContent;
  }

  // Identifiant stable d'une ligne (la grille virtualisée recrée les éléments) :
  // aria-rowindex, sinon le n° de ligne de la cellule « GridCell-<ligne>-… », sinon le code.
  function rowKey(row, qty, code) {
    const idx = row.getAttribute('aria-rowindex');
    if (idx) return `i${idx}`;
    const cell = qty && qty.closest('[role="gridcell"]');
    const m = cell && /^GridCell-(\d+)-/.exec(cell.id || '');
    if (m) return `c${m[1]}`;
    return `k${code}`;
  }

  function headerRowCount(grid) {
    return [...grid.querySelectorAll('[role="row"]')].filter((r) => r.querySelector('[role="columnheader"]')).length;
  }

  // Conteneur qui fait défiler la grille : la grille, un élément dedans, ou un parent dans la fenêtre. Sinon null.
  function scrollBox(grid, dialog) {
    const scrolls = (n) => n.scrollHeight > n.clientHeight && /(auto|scroll)/.test(getComputedStyle(n).overflowY);
    for (const n of [grid, ...grid.querySelectorAll('*')]) if (scrolls(n)) return n;
    for (let n = grid.parentElement; n && n !== dialog && n !== document.body; n = n.parentElement) if (scrolls(n)) return n;
    return null;
  }

  // Lignes dessinées maintenant : { row, key, code (AR00000000 / CHUTE / TEMPS_PROD), qty (champ Quantité ou null) }
  function bomRows(grid) {
    const out = [];
    for (const row of grid.querySelectorAll('[role="row"]')) {
      if (row.querySelector('[role="columnheader"]')) continue;
      const qty = row.querySelector(QTY_INPUT_SEL);
      let code = null;
      for (const cell of row.querySelectorAll('[role="gridcell"]')) {
        if (qty && cell.contains(qty)) continue;
        const v = String(cellText(cell) || '').trim();
        if (CODE_CELL_RE.test(v)) {
          code = v.toUpperCase();
          break;
        }
      }
      if (!code) continue;
      if (code !== 'CHUTE' && code !== 'TEMPS_PROD') code = FD.normalizeArCode(code);
      if (code) out.push({ row, key: rowKey(row, qty, code), code, qty });
    }
    return out;
  }

  // Toutes les lignes sont-elles lues ? aria-rowcount (lignes d'en-tête comprises) s'il est donné,
  // sinon : grille sans défilement.
  function isComplete(grid, seenCount, headerCount, reachedEnd) {
    const total = Number(grid.getAttribute('aria-rowcount'));
    if (Number.isInteger(total) && total > 0) return seenCount + headerCount >= total;
    return reachedEnd;
  }

  // Relevé immédiat, sans défilement (aperçu du panneau)
  function snapshotGrid() {
    const bom = findBom();
    if (!bom) return null;
    const rows = bomRows(bom.grid);
    const keys = new Map();
    for (const r of rows) if (!keys.has(r.key)) keys.set(r.key, r.code);
    const box = scrollBox(bom.grid, bom.dialog);
    return { codes: [...keys.values()], complete: isComplete(bom.grid, keys.size, headerRowCount(bom.grid), !box), scrolled: false };
  }

  // Relevé complet : fait défiler la grille du haut en bas pour lire les lignes hors écran,
  // puis remet le défilement où il était.
  async function scanGrid() {
    const bom = findBom();
    if (!bom) return null;
    const box = scrollBox(bom.grid, bom.dialog);
    if (!box) return { ...snapshotGrid(), scrolled: true };
    const seen = new Map();
    let headers = 0;
    const collect = () => {
      const b = findBom();
      if (!b) return;
      const h = headerRowCount(b.grid);
      if (h > headers) headers = h;
      for (const r of bomRows(b.grid)) if (!seen.has(r.key)) seen.set(r.key, r.code);
    };
    const start = box.scrollTop;
    let reachedEnd = false;
    box.scrollTop = 0;
    await sleep(SCROLL_PAUSE_MS);
    collect();
    for (let i = 0; i < MAX_SCROLL_STEPS; i++) {
      const before = box.scrollTop;
      box.scrollTop = before + box.clientHeight;
      await sleep(SCROLL_PAUSE_MS);
      collect();
      if (box.scrollTop === before) {
        reachedEnd = true;
        break;
      }
    }
    box.scrollTop = start;
    await sleep(SCROLL_PAUSE_MS);
    const now = findBom();
    return { codes: [...seen.values()], complete: Boolean(now) && isComplete(now.grid, seen.size, headers, reachedEnd), scrolled: true };
  }

  // Ligne du code, en faisant défiler la grille si elle n'est pas dessinée
  async function revealRow(code) {
    let r = currentRow(code);
    if (r) return r;
    const bom = findBom();
    const box = bom && scrollBox(bom.grid, bom.dialog);
    if (!box) return null;
    box.scrollTop = 0;
    await sleep(SCROLL_PAUSE_MS);
    for (let i = 0; i < MAX_SCROLL_STEPS; i++) {
      r = currentRow(code);
      if (r) return r;
      const before = box.scrollTop;
      box.scrollTop = before + box.clientHeight;
      await sleep(SCROLL_PAUSE_MS);
      if (box.scrollTop === before) break;
    }
    return currentRow(code);
  }

  // Ligne unique de ce code dans la grille affichée maintenant (D365 redessine les lignes)
  function currentRow(code) {
    const bom = findBom();
    if (!bom) return null;
    const rows = bomRows(bom.grid).filter((r) => r.code === code);
    return rows.length === 1 ? rows[0] : null;
  }

  // N° de ligne : aria-rowindex, sinon celui de l'id « GridCell-<ligne>-… » de la cellule Quantité
  function rowIndex(r) {
    const idx = Number(r.row.getAttribute('aria-rowindex'));
    if (Number.isInteger(idx) && idx > 0) return idx;
    const cell = r.qty && r.qty.closest('[role="gridcell"]');
    const m = cell && /^GridCell-(\d+)-/.exec(cell.id || '');
    return m ? Number(m[1]) : null;
  }

  // Lignes dont le champ Quantité est modifiable (normalement une seule : la ligne active)
  function editableRows() {
    const bom = findBom();
    return bom ? bomRows(bom.grid).filter((r) => r.qty && isEditable(r.qty)) : [];
  }

  // La ligne active est la ligne cible, et elle seule
  function targetIsActive(code) {
    const act = editableRows();
    return act.length === 1 && act[0].code === code ? act[0] : null;
  }

  async function waitActive(code) {
    for (let i = 0; i < ACTIVATE_TRIES; i++) {
      await sleep(ACTIVATE_POLL_MS);
      const r = targetIsActive(code);
      if (r) return r;
    }
    return null;
  }

  const center = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });

  // Séquence souris complète au centre de l'élément, envoyée à l'élément le plus profond à ce point
  // (le panneau Façonote est caché le temps de le trouver, pour ne pas être touché lui-même).
  function mouseSequence(el) {
    el.scrollIntoView({ block: 'nearest' });
    const { x, y } = center(el.getBoundingClientRect());
    const vis = host.style.visibility;
    host.style.visibility = 'hidden';
    let target = document.elementFromPoint(x, y);
    host.style.visibility = vis;
    if (!target || !el.closest('[role="row"]').contains(target)) target = el;
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y };
    const ptr = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    const down = { ...base, button: 0, buttons: 1 };
    const up = { ...base, button: 0, buttons: 0 };
    target.dispatchEvent(new PointerEvent('pointerover', { ...base, ...ptr }));
    target.dispatchEvent(new MouseEvent('mouseover', base));
    target.dispatchEvent(new PointerEvent('pointerdown', { ...down, ...ptr }));
    target.dispatchEvent(new MouseEvent('mousedown', down));
    target.dispatchEvent(new PointerEvent('pointerup', { ...up, ...ptr }));
    target.dispatchEvent(new MouseEvent('mouseup', up));
    target.dispatchEvent(new MouseEvent('click', up));
  }

  function pressKey(el, down) {
    const k = down ? { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 } : { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38 };
    const opts = { ...k, bubbles: true, cancelable: true, composed: true, view: window };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  // Une méthode d'activation ; renvoie la ligne cible devenue active, ou null
  async function tryActivation(method, code) {
    const r = await revealRow(code);
    if (!r || !r.qty) return null;
    if (method === 'souris sur Quantité') {
      mouseSequence(r.qty.closest('[role="gridcell"]') || r.qty);
      return waitActive(code);
    }
    if (method === 'souris sur la ligne') {
      const cell = [...r.row.querySelectorAll('[role="gridcell"]')].find((c) => !c.contains(r.qty));
      if (!cell) return null;
      mouseSequence(cell);
      return waitActive(code);
    }
    // Clavier : depuis le champ de la ligne active, flèche bas ou haut, un pas à la fois
    const target = rowIndex(r);
    if (target === null) return null;
    for (let i = 0; i < MAX_KEY_STEPS; i++) {
      const act = editableRows();
      if (act.length !== 1) return null;
      if (act[0].code === code) return act[0];
      const from = rowIndex(act[0]);
      if (from === null || from === target) return null;
      act[0].qty.focus();
      pressKey(act[0].qty, from < target);
      let moved = false;
      for (let j = 0; j < ACTIVATE_TRIES && !moved; j++) {
        await sleep(ACTIVATE_POLL_MS);
        const now = editableRows();
        moved = now.length === 1 && rowIndex(now[0]) !== from;
      }
      if (!moved) return null;
    }
    return targetIsActive(code);
  }

  // Active la ligne du code et attend que son champ Quantité, et lui seul, soit modifiable.
  // { input, method } ou { error }
  async function activateRow(code) {
    const first = await revealRow(code);
    if (!first || !first.qty) return { error: 'ligne introuvable' };
    const already = targetIsActive(code);
    if (already) return { input: already.qty, method: 'ligne déjà active' };
    const order = state.activationMethod
      ? [state.activationMethod, ...ACTIVATION_METHODS.filter((m) => m !== state.activationMethod)]
      : ACTIVATION_METHODS;
    for (const method of order) {
      const r = await tryActivation(method, code);
      if (r) {
        state.activationMethod = method;
        return { input: r.qty, method };
      }
    }
    return { error: 'pas modifiable : cliquez sur la ligne, puis relancez' };
  }

  // Case vide (D365 n'affiche pas de 0 pour une ligne bobine)
  function isEmptyQuantity(shown) {
    return String(shown || '').trim() === '';
  }

  // Ligne vidée : case vide ou 0
  function isCleared(shown) {
    return isEmptyQuantity(shown) || parseNumber(shown) === 0;
  }

  // Ce qui serait fait dans la fenêtre ouverte, sans rien écrire.
  // grid : relevé { codes, complete, scrolled } (snapshotGrid ou scanGrid).
  // { error } ou { bom, order, group, tasks, problems, ignored }
  function planCoils(grid) {
    const bom = findBom();
    if (!bom || !grid) return { error: 'Fenêtre Nomenclature non trouvée.' };
    const d = detectBomOrder(bom.dialog);
    state.detected = d;
    if (d.status === 'AUCUN') return { error: 'Aucun n° CC derrière la fenêtre.' };
    if (d.status === 'AMBIGU') return { error: `Plusieurs n° CC : ${d.all.join(', ')}.` };
    const order = state.orders[d.orderNumber];
    if (!order) {
      return { error: `${d.orderNumber} absente de l'extension : envoyez-la depuis Façonote.` };
    }
    const rows = grid.codes.map((code) => ({ code }));
    const codes = new Set(grid.codes);
    const gridArs = [...codes].filter((c) => FD.AR_RE.test(c));
    const candidates = order.groups.filter((g) => g.all_articles.some((a) => codes.has(a)));
    if (!candidates.length) {
      // Aucune bobine de la commande dans la grille : codes de toutes les bobines commandées, à ajouter à la main
      const copies = order.groups.flatMap((g) => g.coils.map((c) => ({ text: `${g.material} · ${c.width_mm} mm`, title: c.article, copy: c.article })));
      return {
        error: `Matière inconnue pour ${order.orderNumber}.`,
        errorDetail: { summary: 'AR de la grille', lines: gridArs.length ? gridArs : ['aucun'] },
        copies,
      };
    }
    if (candidates.length > 1) {
      return { error: `Plusieurs matières possibles : ${candidates.map((g) => g.material).join(', ')}.` };
    }
    const group = candidates[0];
    const tasks = [];
    const problems = [];
    // Grille lue en entier : une ligne manquante est absente. Sinon, on ne peut pas le dire (grille virtualisée).
    const notSeen = grid.complete
      ? null
      : grid.scrolled
      ? 'non trouvé : faites défiler la grille, puis relancez'
      : 'hors écran, lu au pré-remplissage';
    // label : largeur (ou « Chute ») ; le code article reste au survol (title) ou en petit
    // copy : code à ajouter à la main dans D365 (+ Nouveau), affiché pour un copier-coller
    const want = (code, label, value, absentText, unit = 'm') => {
      const found = rows.filter((r) => r.code === code);
      if (!found.length) problems.push({ text: notSeen ? `${label} ${notSeen}` : absentText, title: code, copy: code });
      else if (found.length > 1) problems.push({ text: `${label} : ${found.length} lignes, impossible de choisir`, title: code });
      else tasks.push({ code, label, value, unit });
    };
    for (const c of group.coils) {
      const label = `${c.width_mm} mm`;
      // Codes saisis en kilos dans D365 : poids calculé par le backend (quantity_kg)
      const kg = c.quantity_kg != null;
      want(c.article, label, kg ? c.quantity_kg : c.quantity_m, `${label} absent : ajoutez-le (+ Nouveau)`, kg ? 'kg' : 'm');
    }
    if (group.chute_m > 0) {
      want('CHUTE', 'Chute', group.chute_m, 'Chute absente : ajoutez-la (+ Nouveau)');
    }
    const wanted = new Set([...group.coils.map((c) => c.article), ...(group.chute_m > 0 ? ['CHUTE'] : [])]);
    // Remplacement complet : une ligne de cette matière (AR connu ou CHUTE) absente du nouvel envoi est vidée.
    // Une ligne déjà vide n'est pas touchée (vérifié au moment de la saisie).
    for (const code of new Set(rows.map((r) => r.code))) {
      if (wanted.has(code)) continue;
      if (code !== 'CHUTE' && !group.all_articles.includes(code)) continue;
      if (rows.filter((r) => r.code === code).length > 1) continue;
      tasks.push({ code, label: code === 'CHUTE' ? 'Chute' : code, value: null });
    }
    const taskCodes = new Set(tasks.map((t) => t.code));
    const ignored = [];
    for (const r of rows) {
      if (taskCodes.has(r.code) || wanted.has(r.code)) continue;
      if (r.code === 'TEMPS_PROD') ignored.push('TEMPS_PROD');
      else if (r.code === 'CHUTE') ignored.push('CHUTE (pas de chute)');
      else if (group.all_articles.includes(r.code)) ignored.push(`${r.code} (pas commandé)`);
      else ignored.push(`${r.code} (inconnu)`);
    }
    return { bom, order, group, tasks, problems, ignored };
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
    bomMode: false, // fenêtre Nomenclature ouverte
    coilSignals: {}, // « CC|matière » -> nombre de signalements du dernier pré-remplissage des bobines
    activationMethod: null, // méthode d'activation de ligne qui a marché (essayée en premier ensuite)
  };

  const hasCoilPart = (g) => g.coils.length > 0 || g.chute_m > 0;
  // Parties à faire d'une commande : DEV (done) et bobines (coilsDone)
  const remainingParts = (o) => o.groups.filter((g) => !g.done).length + o.groups.filter((g) => !g.coilsDone).length;

  // ---------- Panneau (Shadow DOM, sans innerHTML) ----------
  // L'essentiel reste visible (commande, matière, ce qui sera rempli ou vidé, action, résultat) ;
  // le détail (DEV, lignes de bobines, diagnostic) est replié dans des <details>.

  const host = document.createElement('div');
  host.id = 'faconote-d365-host';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000; left: 16px; bottom: 16px;';
  const root = host.attachShadow({ mode: 'closed' });
  // Le clavier dans le panneau ne doit pas déclencher les raccourcis D365
  for (const t of ['keydown', 'keyup', 'keypress']) host.addEventListener(t, (e) => e.stopPropagation());

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; font-size: 12px; line-height: 1.35; }
    .fab { border: 0; border-radius: 4px; padding: 6px 12px; font-weight: 600; color: #fff;
           background: #00478a; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
    .fab.todo { background: #d84a17; }
    .fab:focus-visible, button.b:focus-visible, select:focus-visible, summary:focus-visible, li:focus-visible {
      outline: 2px solid #3ca7da; outline-offset: 1px; }
    .panel { position: absolute; left: 0; bottom: 36px; width: 340px; max-height: 60vh; overflow: auto;
             background: #fff; color: #222; border: 1px solid #b8c4d0; border-top: 3px solid #00478a;
             border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.18); padding: 6px 8px 8px; }
    .hidden { display: none; }
    .top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .title { font-weight: 700; color: #00478a; }
    .row { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
    .muted { color: #666; } .small { font-size: 11px; color: #666; }
    .ok { color: #1b5e20; } .ko { color: #b71c1c; } .warn { color: #8a5a00; }
    .order { margin-top: 6px; }
    select { display: block; width: 100%; padding: 2px 4px; border: 1px solid #b0b0b0; border-radius: 3px; background: #fff; }
    button.b { padding: 3px 8px; border: 1px solid #b0b0b0; border-radius: 3px; background: #fff; color: #222; cursor: pointer; }
    button.b:not(.primary) { padding: 2px 6px; font-size: 11px; }
    button.b.primary { background: #00478a; border-color: #00478a; color: #fff; font-weight: 600; }
    button.b.danger { color: #b71c1c; border-color: #e0a0a0; }
    button.b:disabled { opacity: .45; cursor: default; }
    ul { list-style: none; margin: 6px 0 0; padding: 0; }
    li { display: flex; justify-content: space-between; gap: 8px; padding: 2px 6px;
         border-left: 3px solid transparent; cursor: pointer; }
    li.sel { background: #eef6fb; border-left-color: #3ca7da; }
    .tag { font-weight: 600; } .tag.done { color: #1b5e20; } .tag.todo { color: #d84a17; }
    .plan { margin-top: 6px; }
    table { border-collapse: collapse; width: 100%; margin-top: 2px; }
    td, th { border-bottom: 1px solid #eee; padding: 1px 4px; text-align: left; font-weight: normal; }
    th { color: #666; }
    td.num { text-align: right; font-family: Consolas, monospace; }
    .code { font-size: 10px; color: #888; font-family: Consolas, monospace; margin-left: 4px; }
    .msg { margin-top: 6px; padding: 4px 6px; border-left: 3px solid; }
    .msg.ok { background: #eef7ef; border-color: #1b5e20; }
    .msg.ko { background: #fdeeee; border-color: #b71c1c; }
    .msg.warn { background: #fff8e8; border-color: #d84a17; }
    .head { font-weight: 700; } .line { margin-top: 2px; }
    .copyline { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    input.copy { font: 11px Consolas, monospace; padding: 1px 3px; border: 1px solid #b0b0b0; border-radius: 3px; background: #fff; color: #222; user-select: all; }
    button.cp { font-size: 11px; padding: 1px 6px; border: 1px solid #b0b0b0; border-radius: 3px; background: #fff; color: #222; cursor: pointer; }
    details { margin-top: 2px; } summary { cursor: pointer; color: #555; font-size: 11px; }
    details div { font-size: 11px; color: #555; }
    pre { margin: 4px 0 0; padding: 4px; background: #f5f5f5; white-space: pre-wrap;
          font-family: Consolas, monospace; font-size: 11px; max-height: 220px; overflow: auto; }
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

  const fab = el('button', { class: 'fab', text: 'Façonote', title: 'Façonote → D365', 'aria-expanded': 'false' });
  const panel = el('div', { class: 'panel hidden', role: 'region', 'aria-label': 'Façonote → D365' });
  root.append(panel, fab);
  fab.addEventListener('click', () => {
    state.open = !state.open;
    panel.classList.toggle('hidden', !state.open);
    fab.setAttribute('aria-expanded', String(state.open));
    if (state.open) render();
  });

  // Message : une ligne de tête, des lignes courtes (signalements), un texte en petit,
  // et des détails repliés (lignes ignorées, méthode d'activation…).
  // { kind: 'ok'|'ko'|'warn', text, lines: [texte | { text, title }], small, details: [{ summary, lines }] }
  let message = null;
  let diagnostic = null; // texte de « Lire l'écran »

  function setMessage(kind, text, extra = {}) {
    message = { kind, text, ...extra };
    render();
  }

  // « 1 ligne ignorée », « 2 lignes ignorées »
  const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
  const ignoredDetails = (ignored) =>
    ignored.length ? { summary: plural(ignored.length, 'ligne ignorée', 'lignes ignorées'), lines: ignored } : null;

  const currentOrder = () => (state.selectedOrder ? state.orders[state.selectedOrder] : null);
  const currentGroup = () => {
    const o = currentOrder();
    return o ? o.groups.find((g) => g.material === state.selectedMaterial) || null : null;
  };
  const ordersByDate = () =>
    Object.keys(state.orders).sort((a, b) => String(state.orders[b].receivedAt).localeCompare(String(state.orders[a].receivedAt)));

  function pickDefaults() {
    // Présélection : la commande affichée dans D365, sinon le dernier choix, sinon la plus récente
    if (!state.userPickedOrder && state.detected.orderNumber && state.orders[state.detected.orderNumber]) {
      state.selectedOrder = state.detected.orderNumber;
    }
    if (!state.selectedOrder || !state.orders[state.selectedOrder]) state.selectedOrder = ordersByDate()[0] || null;
    const o = currentOrder();
    if (o && !o.groups.some((g) => g.material === state.selectedMaterial)) {
      const todo = o.groups.find((g) => !g.done);
      state.selectedMaterial = (todo || o.groups[0]).material;
    }
  }

  function updateFab() {
    const o = state.detected.orderNumber ? state.orders[state.detected.orderNumber] : null;
    const remaining = o ? remainingParts(o) : 0;
    fab.classList.toggle('todo', remaining > 0);
    fab.textContent = remaining > 0 ? `Façonote · ${remaining} à faire` : 'Façonote';
  }

  // ----- Briques du panneau -----

  // Bloc replié ; reste ouvert d'un rendu à l'autre tant que l'utilisateur ne le ferme pas
  const openFolds = new Set();
  function fold(key, summary, children) {
    const onToggle = (e) => (e.currentTarget.open ? openFolds.add(key) : openFolds.delete(key));
    return el('details', { ...(openFolds.has(key) ? { open: '' } : {}), ontoggle: onToggle }, [el('summary', { text: summary }), ...children]);
  }
  // Clé sans les nombres : le pli reste ouvert quand le compte change, une seule clé par type de liste
  const listFold = (d) => fold(`liste:${d.summary.replace(/\d+/g, '#')}`, d.summary, d.lines.map((t) => el('div', { text: t })));

  const btn = (text, onclick, { kind = '', off = false, title = '' } = {}) =>
    el('button', { class: kind ? `b ${kind}` : 'b', text, onclick, 'data-focus': `bouton:${text}`, ...(title ? { title } : {}), ...(off ? { disabled: '' } : {}) });

  // Ligne avec un code à copier : texte, champ en lecture seule (tout sélectionné au clic) et bouton Copier
  function copyLine(l, cls) {
    const field = el('input', {
      class: 'copy', value: l.copy, readonly: '', size: String(l.copy.length), 'aria-label': `Code ${l.copy}`,
      'data-focus': `copie:${l.copy}`, onfocus: (e) => e.target.select(), onclick: (e) => e.target.select(),
    });
    const onCopy = async (e) => {
      const b = e.currentTarget;
      try {
        await navigator.clipboard.writeText(l.copy);
        b.textContent = 'Copié ✓';
      } catch (_) {
        field.focus();
        field.select();
        b.textContent = 'Ctrl+C';
      }
    };
    return el('div', { class: `${cls} copyline`, title: l.title || l.copy }, [
      el('span', { text: l.text }),
      field,
      el('button', { class: 'cp', text: 'Copier', title: `Copier ${l.copy}`, 'data-focus': `copier:${l.copy}`, onclick: onCopy }),
    ]);
  }

  const table = (head, rows) => el('table', {}, [el('tr', {}, head.map((t) => el('th', { text: t, scope: 'col' }))), ...rows]);

  function headerRow() {
    const d = state.detected;
    const [cls, text] =
      d.status === 'OK' ? ['ok', `À l’écran : ${d.orderNumber}`]
      : d.status === 'AMBIGU' ? ['warn', `Plusieurs CC à l’écran : ${d.all.join(', ')}`]
      : ['muted', 'Aucun CC à l’écran'];
    return el('div', { class: 'top' }, [el('span', { class: 'title', text: 'Façonote → D365' }), el('span', { class: cls, text })]);
  }

  function orderRow(nums, o) {
    const sel = el('select', {
      'aria-label': 'Commande',
      'data-focus': 'commande',
      onchange: (e) => {
        state.selectedOrder = e.target.value;
        state.selectedMaterial = null;
        state.userPickedOrder = true;
        render();
      },
    });
    for (const n of nums) {
      const left = remainingParts(state.orders[n]);
      const opt = el('option', { value: n, text: `${n} — ${left ? `${left} à faire` : 'terminée'}` });
      if (n === state.selectedOrder) opt.selected = true;
      sel.appendChild(opt);
    }
    const when = o && o.sentAt ? new Date(o.sentAt).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '?';
    return el('div', { class: 'order' }, [sel, el('div', { class: 'small', text: `Envoyée le ${when}` })]);
  }

  const tag = (done, text) => el('span', { class: `tag ${done ? 'done' : 'todo'}`, text });

  function coilTagText(o, g) {
    if (g.coilsDone) return 'fait';
    const n = state.coilSignals[`${o.orderNumber}|${g.material}`];
    return n ? `à faire (${plural(n, 'signalement')})` : 'à faire';
  }

  // Une matière de la commande : nom, puis état DEV / bobines. Clic ou Entrée pour la choisir.
  function materialItem(o, g) {
    const choose = () => {
      state.selectedMaterial = g.material;
      render();
    };
    const coils = hasCoilPart(g);
    const name = !coils || g.has_pieces ? `${g.material} → ${g.matiere} / ${g.epaisseur}` : `${g.material} (bobines seules)`;
    const status = coils
      ? el('span', {}, [
          g.has_pieces ? tag(g.done, `DEV : ${g.done ? 'fait' : 'à faire'}`) : el('span', { class: 'tag', text: 'DEV : —' }),
          el('span', { text: ' · ' }),
          tag(g.coilsDone, `Bobines : ${coilTagText(o, g)}`),
        ])
      : tag(g.done, g.done ? 'fait' : 'à faire');
    const selected = g.material === state.selectedMaterial;
    return el('li', {
      class: selected ? 'sel' : '',
      tabindex: '0',
      'data-focus': `matière:${g.material}`,
      ...(selected ? { 'aria-current': 'true' } : {}),
      onclick: choose,
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      },
    }, [el('span', { text: name }), status]);
  }

  function orderSection(o) {
    const nums = ordersByDate();
    if (!nums.length) return [el('div', { class: 'muted', text: 'Aucune commande : cliquez « Envoyer vers D365 » dans Façonote.' })];
    const d = state.detected;
    return [
      orderRow(nums, o),
      o && d.status === 'OK' && d.orderNumber !== o.orderNumber ? el('div', { class: 'warn', text: 'Pas la commande à l’écran.' }) : null,
      o ? el('ul', { 'aria-label': 'Matières de la commande' }, o.groups.map((g) => materialItem(o, g))) : null,
    ];
  }

  // Fiche principale : ce qui sera rempli dans les DEV (tableau replié)
  function devPlan(g) {
    if (!g) return null;
    if (!g.has_pieces) return el('div', { class: 'plan muted', text: 'Pas de pièce.' });
    const bounds = FD.BOUNDS.filter((b) => g.lengths[String(b)] > 0);
    if (!bounds.length) return el('div', { class: 'plan small', text: 'DEV : tous à 0' });
    const rows = bounds.map((b) => el('tr', {}, [el('td', { text: `DEV${b}` }), el('td', { class: 'num', text: FD.formatD365(g.lengths[String(b)]) })]));
    return el('div', { class: 'plan' }, [fold('dev', `${bounds.length} DEV à remplir, les autres à 0`, [table(['DEV', 'm'], rows)])]);
  }

  // Fenêtre Nomenclature, avant la saisie (lecture seule) : lignes à remplir, lignes vidées si remplies
  function coilPlan(p) {
    const box = el('div', { class: 'msg warn' });
    if (p.error) {
      box.append(el('div', { class: 'head ko', text: p.error }));
      if (p.copies && p.copies.length) {
        box.append(el('div', { class: 'line', text: 'Bobines de la commande à ajouter (+ Nouveau) :' }));
        for (const c of p.copies) box.append(copyLine(c, 'line'));
      }
      if (p.errorDetail) box.append(listFold(p.errorDetail));
      return box;
    }
    const fills = p.tasks.filter((t) => t.value !== null);
    const clears = p.tasks.filter((t) => t.value === null);
    box.append(el('div', { class: 'head', text: `Bobines · ${p.group.material}` }));
    if (p.tasks.length) {
      const summary = `${fills.length} à remplir` + (clears.length ? ` · ${plural(clears.length, 'vidée si remplie', 'vidées si remplies')}` : '');
      const rows = [
        ...fills.map((t) => el('tr', {}, [
          el('td', { title: t.code }, [el('span', { text: t.label }), t.code !== 'CHUTE' ? el('span', { class: 'code', text: t.code }) : null]),
          el('td', { class: 'num', text: t.unit === 'kg' ? `${FD.formatD365(t.value)} kg` : FD.formatD365(t.value) }),
        ])),
        ...clears.map((t) => el('tr', {}, [el('td', { text: t.code }), el('td', { class: 'num', text: '(vidé)' })])),
      ];
      box.append(fold('bobines', summary, [table(['Ligne', 'm'], rows)]));
    } else if (!p.problems.length) {
      box.append(el('div', { text: 'Rien à saisir.' }));
    }
    for (const pr of p.problems) box.append(pr.copy ? copyLine(pr, 'line ko') : el('div', { class: 'line ko', text: pr.text, title: pr.title }));
    const ig = ignoredDetails(p.ignored);
    if (ig) box.append(listFold(ig));
    return box;
  }

  function actionRow(bomPlan, g) {
    const busy = state.busy;
    const noPieces = !g || !g.has_pieces;
    const noPiecesTitle = g && !g.has_pieces ? 'Pas de pièce dans cette matière' : '';
    // Fenêtre Nomenclature : « Marquer » vise les bobines de la matière reconnue dans la grille
    const coilTarget = bomPlan && !bomPlan.error && hasCoilPart(bomPlan.group) ? bomPlan.group : null;
    const toggleText = coilTarget
      ? coilTarget.coilsDone ? 'Marquer bobines à faire' : 'Marquer bobines faites'
      : g && g.done ? 'Marquer à faire' : 'Marquer fait';
    return el('div', { class: 'row' }, [
      // Fenêtre Nomenclature : pas de DEV à remplir, seul le bouton des bobines est proposé
      state.bomMode
        ? btn('Pré-remplir les bobines', onFillCoils, { kind: 'primary', off: busy })
        : btn('Pré-remplir', onFill, { kind: 'primary', off: busy || noPieces, title: noPiecesTitle || 'Pré-remplir Matières, Epaisseur et les DEV' }),
      btn(toggleText, onToggleDone, { off: busy || (!coilTarget && noPieces), title: coilTarget ? '' : noPiecesTitle }),
      btn('Lire l’écran', onReadScreen, { off: busy }),
      btn('Vider', onDelete, { kind: 'danger', off: busy || !currentOrder(), title: 'Vider cette commande de l’extension' }),
    ]);
  }

  function messageBox(m) {
    const lines = (m.lines || []).map((l) => (typeof l === 'string' ? { text: l } : l));
    return el('div', { class: `msg ${m.kind}`, role: 'status' }, [
      el('div', { class: 'head', text: m.text }),
      ...lines.map((l) => (l.copy ? copyLine(l, 'line') : el('div', { class: 'line', text: l.text, ...(l.title ? { title: l.title } : {}) }))),
      ...(m.small ? String(m.small).split('\n').map((t) => el('div', { class: 'small', text: t })) : []),
      ...(m.details || []).filter(Boolean).map(listFold),
    ]);
  }

  function render() {
    updateFab();
    if (!state.open) return;
    // Fenêtre Nomenclature : la commande et la matière sont celles reconnues dans la grille
    const bomPlan = state.bomMode ? planCoils(snapshotGrid()) : null;
    if (bomPlan && !bomPlan.error && !state.userPickedOrder) {
      state.selectedOrder = bomPlan.order.orderNumber;
      state.selectedMaterial = bomPlan.group.material;
    }
    pickDefaults();
    const o = currentOrder();
    const g = currentGroup();
    const nodes = [
      headerRow(),
      ...orderSection(o),
      // Fenêtre Nomenclature : aperçu des bobines d'abord, remplacé par le résultat après une saisie
      state.bomMode && !message ? coilPlan(bomPlan) : null,
      devPlan(g),
      actionRow(bomPlan, g),
      message ? messageBox(message) : null,
      diagnostic ? fold('diagnostic', 'Diagnostic des champs', [el('pre', { text: diagnostic })]) : null,
    ];
    const focusKey = root.activeElement ? root.activeElement.getAttribute('data-focus') : null;
    panel.replaceChildren(...nodes.filter(Boolean));
    restoreFocus(focusKey);
  }

  // Le panneau est refait à chaque rendu : le focus revient sur l'élément équivalent (même data-focus)
  function restoreFocus(key) {
    if (!key) return;
    const same = [...panel.querySelectorAll('[data-focus]')].find((n) => n.getAttribute('data-focus') === key);
    if (same && !same.disabled) same.focus();
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
    try {
      if (state.bomMode) {
        const p = planCoils(snapshotGrid());
        if (!p.error && hasCoilPart(p.group)) {
          const coilsDone = !p.group.coilsDone;
          await updateGroup(p.order.orderNumber, p.group.material, { coilsDone, coilsDoneAt: coilsDone ? new Date().toISOString() : null });
          setMessage('ok', `${p.group.material} : bobines marquées ${coilsDone ? 'faites' : 'à faire'}.`);
          return;
        }
      }
      const o = currentOrder();
      const g = currentGroup();
      if (!o || !g || !g.has_pieces) return;
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
    if (!window.confirm(`Vider la commande ${o.orderNumber} de l’extension ?\n(Rien n’est modifié dans D365 ni dans Façonote.)`)) return;
    try {
      const orders = await FD.loadOrders();
      delete orders[o.orderNumber];
      await FD.saveOrders(orders);
      state.orders = orders;
      state.selectedOrder = null;
      state.selectedMaterial = null;
      state.userPickedOrder = false;
      setMessage('ok', `Commande ${o.orderNumber} vidée de l’extension.`);
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
        ? `Plusieurs CC à l’écran : ${d.all.join(', ')}.`
        : `Aucun CC à l’écran : ouvrez ${o.orderNumber}.`);
      return;
    }
    if (d.orderNumber !== o.orderNumber) {
      setMessage('ko', `D365 affiche ${d.orderNumber}, pas ${o.orderNumber}.`);
      return;
    }

    // 2. Les champs à saisir doivent exister, être visibles et modifiables AVANT toute écriture
    const toFill = fieldsToFill(g);
    // Remplacement complet : un DEV après la dernière borne qui contient encore une valeur est remis à 0
    for (const f of FIELDS) {
      if (toFill.includes(f)) continue;
      const r = inspectField(f);
      const n = r.el ? parseNumber(r.el.value) : NaN;
      if (Number.isFinite(n) && n !== 0) toFill.push(f);
    }
    const problems = [];
    for (const f of toFill) {
      const r = inspectField(f);
      if (r.state !== 'OK') problems.push(`${f.label} : ${r.state}`);
    }
    if (problems.length) {
      setMessage('ko', 'Rien écrit : champs non prêts.', {
        lines: problems,
        small: 'Passez en mode Modifier, puis réessayez (détail : « Lire l’écran »).',
      });
      return;
    }

    state.busy = true;
    setMessage('warn', `${g.material} : saisie en cours…`, { small: 'Ne touchez pas à la page.' });
    try {
      // 3. Écriture champ par champ, en re-cherchant chaque champ (D365 redessine le DOM)
      // Un champ qui affiche déjà la bonne valeur n'est pas réécrit (pas de pause).
      let written = 0;
      for (const f of toFill) {
        const now = detectOrder();
        if (now.orderNumber !== o.orderNumber) throw new Error('commande changée pendant la saisie, arrêt');
        const r = inspectField(f);
        if (r.state !== 'OK') throw new Error(`${f.label} plus modifiable (${r.state}), arrêt`);
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
          mismatches.push(`${f.label} : lu « ${shown === undefined ? '—' : shown} », attendu « ${f.kind === 'number' ? FD.formatD365(expected) : expected} »`);
        }
      }
      // DEV après la dernière borne : relecture (une valeur non nulle a été remise à 0 plus haut)
      for (const f of FIELDS) {
        if (toFill.includes(f)) continue;
        const r = inspectField(f);
        if (!r.el) continue;
        const n = parseNumber(r.el.value);
        if (Number.isFinite(n) && n !== 0) {
          mismatches.push(`${f.label} : « ${r.el.value} », attendu 0 (à corriger)`);
        }
      }
      if (mismatches.length) {
        state.busy = false;
        setMessage('ko', `${g.material} : DEV à faire`, { lines: mismatches, small: 'Vérifiez avant d’enregistrer.' });
        return;
      }

      await updateGroup(o.orderNumber, g.material, { done: true, doneAt: new Date().toISOString() });
      const next = state.orders[o.orderNumber].groups.find((x) => !x.done);
      if (next) state.selectedMaterial = next.material;
      state.busy = false;
      setMessage('ok', `${g.material} : DEV OK ✓`, {
        lines: ['Vérifiez, puis Enregistrer.'],
        small: `${written} écrit${written > 1 ? 's' : ''}` + (next ? ` · suivante : ${next.material}` : ' · commande terminée'),
      });
    } catch (err) {
      state.busy = false;
      setMessage('ko', `${g.material} : DEV à faire`, { lines: [errorText(err)], small: 'Vérifiez les champs.' });
    }
  }

  // Pré-remplissage de la colonne Quantité de la grille Nomenclature.
  // Aucun clic sur Enregistrer, + Nouveau, Supprimer, ni sur la liste des OF.
  async function onFillCoils() {
    if (state.busy) return;
    diagnostic = null;
    state.busy = true;
    setMessage('warn', 'Lecture de la grille en cours…', { small: 'Ne touchez pas à la page.' });
    let p;
    try {
      p = planCoils(await scanGrid());
    } catch (err) {
      p = { error: errorText(err) };
    }
    state.busy = false;
    if (p.error) {
      setMessage('ko', p.error, { lines: p.copies && p.copies.length ? [{ text: 'Bobines de la commande à ajouter (+ Nouveau) :' }, ...p.copies] : [], details: [p.errorDetail] });
      return;
    }
    const { order, group } = p;
    const key = `${order.orderNumber}|${group.material}`;
    state.selectedOrder = order.orderNumber;
    state.selectedMaterial = group.material;
    state.userPickedOrder = true;
    const ignored = ignoredDetails(p.ignored);
    if (p.problems.length) {
      state.coilSignals[key] = p.problems.length;
      setMessage('ko', `${group.material} : rien écrit`, { lines: p.problems, details: [ignored] });
      return;
    }
    if (!p.tasks.length) {
      setMessage('warn', `${group.material} : rien à saisir`, { details: [ignored] });
      return;
    }

    state.busy = true;
    setMessage('warn', `${group.material} : saisie en cours…`, { small: 'Ne touchez pas à la page.' });
    const signals = [];
    const writtenTasks = [];
    const alreadyCodes = [];
    const methodsUsed = new Set();
    const notWritten = []; // « code (raison) »
    try {
      for (const t of p.tasks) {
        const bom = findBom();
        if (!bom) throw new Error('fenêtre fermée pendant la saisie, arrêt');
        const now = detectBomOrder(bom.dialog);
        if (now.orderNumber !== order.orderNumber) throw new Error('CC changé pendant la saisie, arrêt');
        // Ligne à vider déjà vide : on n'y touche pas (pas d'activation)
        if (t.value === null) {
          const pre = await revealRow(t.code);
          if (pre && pre.qty && isCleared(pre.qty.value)) continue;
        }
        const act = await activateRow(t.code);
        if (act.error) {
          signals.push({ text: `${t.label} : ${act.error}`, title: t.code });
          notWritten.push(`${t.label} ${t.code} (pas modifiable)`);
          continue;
        }
        if (act.method !== 'ligne déjà active') methodsUsed.add(act.method);
        // Jamais d'écriture ailleurs que sur la ligne cible : elle doit être la seule ligne active
        const target = targetIsActive(t.code);
        if (!target) {
          signals.push({ text: `${t.label} : autre ligne active, pas changé`, title: t.code });
          notWritten.push(`${t.label} ${t.code} (autre ligne active)`);
          continue;
        }
        const shown = target.qty.value;
        // Ligne absente du nouvel envoi : vidée (rien à faire si déjà vide ou à 0)
        if (t.value === null) {
          if (isCleared(shown)) continue;
          await writeField(target.qty, '');
          const afterClear = currentRow(t.code);
          if (!afterClear || !afterClear.qty || !isCleared(afterClear.qty.value)) {
            signals.push({ text: `${t.label} : pas vidé (lu ${afterClear && afterClear.qty ? afterClear.qty.value || '—' : '—'})`, title: t.code });
            notWritten.push(`${t.label} (pas vidé)`);
            continue;
          }
          writtenTasks.push(t);
          continue;
        }
        // Remplacement : une valeur différente déjà présente est écrasée par la nouvelle
        if (!isEmptyQuantity(shown) && valueMatches({ kind: 'number' }, shown, t.value)) {
          alreadyCodes.push(t.code);
          continue;
        }
        // Même saisie que les DEV : focus, valeur, input, change, puis blur (la ligne n'est pas laissée en édition)
        await writeField(target.qty, FD.formatD365(t.value));
        const after = currentRow(t.code);
        if (!after || !after.qty || !valueMatches({ kind: 'number' }, after.qty.value, t.value)) {
          signals.push({ text: `${t.label} : lu ${after && after.qty ? after.qty.value || '—' : '—'} au lieu de ${FD.formatD365(t.value)}`, title: t.code });
          notWritten.push(`${t.label} ${t.code} (refusé par D365)`);
          continue;
        }
        writtenTasks.push(t);
      }

      // Relecture finale des lignes écrites
      if (writtenTasks.length) await sleep(VERIFY_DELAY_MS);
      for (const t of writtenTasks) {
        const r = await revealRow(t.code);
        if (t.value === null) {
          if (!r || !r.qty || !isCleared(r.qty.value)) {
            signals.push({ text: `${t.label} : relu ${r && r.qty ? r.qty.value || '—' : '—'} au lieu de vide`, title: t.code });
          }
          continue;
        }
        if (!r || !r.qty || !valueMatches({ kind: 'number' }, r.qty.value, t.value)) {
          signals.push({ text: `${t.label} : relu ${r && r.qty ? r.qty.value || '—' : '—'} au lieu de ${FD.formatD365(t.value)}`, title: t.code });
        }
      }

      const n = writtenTasks.length;
      const a = alreadyCodes.length;
      const count = `${n} écrite${n > 1 ? 's' : ''}, ${a} déjà juste${a > 1 ? 's' : ''}`;
      // Détail replié : codes écrits / non écrits, méthode d'activation (aussi dans la console)
      const detailLines = [
        `Écrits : ${writtenTasks.map((t) => (t.value === null ? `${t.code} (vidé)` : `${t.label} ${t.code}`)).join(', ') || 'aucun'}`,
        ...(a ? [`Déjà justes : ${alreadyCodes.join(', ')}`] : []),
        ...(notWritten.length ? [`Non écrits : ${notWritten.join(', ')}`] : []),
        ...(methodsUsed.size ? [`Activation : ${[...methodsUsed].join(', ')}`] : []),
      ];
      console.info('[Façonote → D365]', group.material, detailLines.join(' | '));
      const details = [{ summary: 'Détail', lines: detailLines }, ignored];
      state.busy = false;
      if (signals.length) {
        state.coilSignals[key] = signals.length;
        setMessage('ko', `${group.material} : bobines à faire`, { lines: signals, small: `${count}\nVérifiez, puis Enregistrer.`, details });
        return;
      }
      delete state.coilSignals[key];
      await updateGroup(order.orderNumber, group.material, { coilsDone: true, coilsDoneAt: new Date().toISOString() });
      setMessage('ok', `${group.material} : bobines OK ✓`, { lines: ['Vérifiez, puis Enregistrer.'], small: count, details });
    } catch (err) {
      state.busy = false;
      state.coilSignals[key] = signals.length + 1;
      const doneCodes = writtenTasks.map((t) => `${t.label} ${t.code}`).join(', ') || 'aucun';
      setMessage('ko', `${group.material} : bobines à faire`, { lines: [errorText(err), ...signals], small: `Écrits avant l’arrêt : ${doneCodes}` });
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
      const beforeBom = state.bomMode;
      const bom = findBom();
      state.bomMode = Boolean(bom);
      state.detected = bom ? detectBomOrder(bom.dialog) : detectOrder();
      if (state.bomMode !== beforeBom) {
        message = null;
        state.userPickedOrder = false;
        render();
      } else if (state.detected.orderNumber !== before) {
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
