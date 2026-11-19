// Façonote → D365 : constantes et accès au stockage partagés par les deux content scripts.
// Aucune requête réseau : tout reste dans chrome.storage.local du navigateur.
'use strict';

// eslint-disable-next-line no-unused-vars
const FD = (() => {
  // Bornes atelier, identiques dans Façonote et dans le formulaire D365 (19 champs « Longueur (DEVxxx) »).
  const BOUNDS = [100, 120, 150, 175, 187, 200, 250, 285, 300, 333, 375, 400, 450, 500, 600, 670, 750, 1000, 1100];
  const ORDER_RE = /^CC\d{11}$/;
  const AR_RE = /^AR\d{8}$/;
  const FACONOTE_ORIGIN = 'https://faconote.jokinesse.be';
  // Depuis 0.4.0 : commandes rangées sous « orders_v2 ». La clé « orders » de 0.2.2 est lue une seule fois
  // (copie dans orders_v2) et n'est jamais modifiée : un retour à 0.2.2 la retrouve intacte.
  const STORAGE_KEY = 'orders_v2';
  const LEGACY_STORAGE_KEY = 'orders';
  const MAX_ORDERS = 50;

  // Code article D365 : « AR-2953 », « ar 2953 » ou « AR00002953 » donnent « AR00002953 ». Autre texte : null.
  function normalizeArCode(text) {
    const t = String(text || '').toUpperCase().replace(/\s+/g, '');
    const m = /^AR-?(\d{1,8})$/.exec(t);
    return m ? `AR${m[1].padStart(8, '0')}` : null;
  }

  // Champs ajoutés en 0.4.0, avec leurs valeurs par défaut (commande pièces seules, comme en 0.2.2).
  // done = partie pièces (DEV) ; coilsDone = partie bobines (grille Nomenclature).
  function withDefaults(g) {
    const coils = Array.isArray(g.coils) ? g.coils : [];
    const chute = typeof g.chute_m === 'number' ? g.chute_m : 0;
    return {
      ...g,
      has_pieces: typeof g.has_pieces === 'boolean' ? g.has_pieces : true,
      coils,
      all_articles: Array.isArray(g.all_articles) ? g.all_articles : [],
      chute_m: chute,
      done: Boolean(g.done),
      doneAt: g.doneAt || null,
      coilsDone: typeof g.coilsDone === 'boolean' ? g.coilsDone : coils.length === 0 && !(chute > 0),
      coilsDoneAt: g.coilsDoneAt || null,
    };
  }

  function withOrderDefaults(o) {
    return { ...o, groups: Array.isArray(o.groups) ? o.groups.map(withDefaults) : [] };
  }

  // Lecture / écriture de toutes les commandes : { [orderNumber]: commande }
  async function loadOrders() {
    const res = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    let orders = res[STORAGE_KEY];
    if (!orders || typeof orders !== 'object') {
      // Premier lancement de 0.4.0 : copie des commandes de 0.2.2, « orders » reste tel quel.
      const legacy = res[LEGACY_STORAGE_KEY];
      orders = {};
      if (legacy && typeof legacy === 'object') {
        for (const [k, o] of Object.entries(legacy)) if (o && typeof o === 'object') orders[k] = withOrderDefaults(o);
      }
      await chrome.storage.local.set({ [STORAGE_KEY]: orders });
      return orders;
    }
    const out = {};
    for (const [k, o] of Object.entries(orders)) if (o && typeof o === 'object') out[k] = withOrderDefaults(o);
    return out;
  }

  async function saveOrders(orders) {
    // On garde les MAX_ORDERS commandes les plus récentes
    const list = Object.values(orders).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
    const kept = {};
    for (const o of list.slice(0, MAX_ORDERS)) kept[o.orderNumber] = o;
    await chrome.storage.local.set({ [STORAGE_KEY]: kept });
  }

  // Nombre au format D365 : virgule décimale, 2 décimales (25,00)
  function formatD365(n) {
    return Number(n).toFixed(2).replace('.', ',');
  }

  return {
    BOUNDS, ORDER_RE, AR_RE, FACONOTE_ORIGIN, STORAGE_KEY, LEGACY_STORAGE_KEY,
    normalizeArCode, withDefaults, loadOrders, saveOrders, formatD365,
  };
})();
