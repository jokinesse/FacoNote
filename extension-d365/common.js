// Façonote → D365 : constantes et accès au stockage partagés par les deux content scripts.
// Aucune requête réseau : tout reste dans chrome.storage.local du navigateur.
'use strict';

// eslint-disable-next-line no-unused-vars
const FD = (() => {
  // Bornes atelier, identiques dans Façonote et dans le formulaire D365 (19 champs « Longueur (DEVxxx) »).
  const BOUNDS = [100, 120, 150, 175, 187, 200, 250, 285, 300, 333, 375, 400, 450, 500, 600, 670, 750, 1000, 1100];
  const ORDER_RE = /^CC\d{11}$/;
  const FACONOTE_ORIGIN = 'https://faconote.jokinesse.be';
  const STORAGE_KEY = 'orders';
  const MAX_ORDERS = 50;

  // Lecture / écriture de toutes les commandes : { [orderNumber]: commande }
  async function loadOrders() {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const orders = res[STORAGE_KEY];
    return orders && typeof orders === 'object' ? orders : {};
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

  return { BOUNDS, ORDER_RE, FACONOTE_ORIGIN, STORAGE_KEY, loadOrders, saveOrders, formatD365 };
})();
