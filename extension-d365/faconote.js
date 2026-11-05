// Content script sur https://faconote.jokinesse.be : reçoit les envois de Façonote (postMessage),
// les valide, les range dans chrome.storage.local et répond ACK ou ERROR à la page.
'use strict';

(() => {
  if (window.top !== window) return;

  const MAX_GROUPS = 30;
  const MAX_TEXT = 100;
  const MAX_LENGTH_M = 100000;

  function reply(payload) {
    window.postMessage({ source: 'faconote-ext', ...payload }, FD.FACONOTE_ORIGIN);
  }

  function isText(v) {
    return typeof v === 'string' && v.trim() !== '' && v.length <= MAX_TEXT;
  }

  // Renvoie un message d'erreur, ou null si le groupe est valide
  function checkGroup(g, i) {
    const where = `Groupe ${i + 1}`;
    if (!g || typeof g !== 'object') return `${where} : format invalide.`;
    if (!isText(g.material)) return `${where} : « material » manquant.`;
    if (!isText(g.matiere)) return `${where} (${g.material}) : « matiere » manquante.`;
    if (!isText(g.epaisseur)) return `${where} (${g.material}) : « epaisseur » manquante.`;
    const lengths = g.lengths;
    if (!lengths || typeof lengths !== 'object') return `${where} (${g.material}) : « lengths » manquant.`;
    const expected = FD.BOUNDS.map(String);
    const extra = Object.keys(lengths).filter((k) => !expected.includes(k));
    if (extra.length) return `${where} (${g.material}) : bornes inconnues ${extra.join(', ')}.`;
    for (const b of expected) {
      const v = lengths[b];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_LENGTH_M) {
        return `${where} (${g.material}) : longueur DEV${b} absente ou invalide.`;
      }
    }
    return null;
  }

  async function handleSend(data) {
    if (!FD.ORDER_RE.test(String(data.orderNumber || ''))) {
      return { type: 'ERROR', error: 'N° de commande invalide (attendu : CC + 11 chiffres).' };
    }
    const groups = data.groups;
    if (!Array.isArray(groups) || groups.length === 0) {
      return { type: 'ERROR', error: 'Aucune matière à envoyer.' };
    }
    if (groups.length > MAX_GROUPS) {
      return { type: 'ERROR', error: `Trop de matières (${groups.length}, maximum ${MAX_GROUPS}).` };
    }
    // Un seul groupe invalide = tout l'envoi est refusé
    const seen = new Set();
    for (let i = 0; i < groups.length; i++) {
      const err = checkGroup(groups[i], i);
      if (err) return { type: 'ERROR', error: err };
      const key = groups[i].material.trim();
      if (seen.has(key)) return { type: 'ERROR', error: `Matière en double : ${key}.` };
      seen.add(key);
    }

    const order = {
      orderNumber: data.orderNumber,
      sentAt: typeof data.sentAt === 'string' ? data.sentAt.slice(0, 40) : null,
      receivedAt: new Date().toISOString(),
      groups: groups.map((g) => ({
        material: g.material.trim(),
        matiere: g.matiere.trim(),
        epaisseur: g.epaisseur.trim(),
        lengths: Object.fromEntries(FD.BOUNDS.map((b) => [String(b), g.lengths[String(b)]])),
        done: false, // un renvoi remet toutes les matières « à faire »
        doneAt: null,
      })),
    };
    const orders = await FD.loadOrders();
    const replaced = Boolean(orders[order.orderNumber]);
    orders[order.orderNumber] = order;
    await FD.saveOrders(orders);
    return {
      type: 'ACK',
      action: replaced ? 'REPLACED' : 'STORED',
      orderNumber: order.orderNumber,
      groups: order.groups.length,
      message: `${replaced ? 'Commande remplacée' : 'Commande reçue'} : ${order.orderNumber} (${order.groups.length} matière${order.groups.length > 1 ? 's' : ''}).`,
    };
  }

  async function handleClear(data) {
    if (!FD.ORDER_RE.test(String(data.orderNumber || ''))) {
      return { type: 'ERROR', error: 'N° de commande invalide pour la suppression.' };
    }
    const orders = await FD.loadOrders();
    const existed = Boolean(orders[data.orderNumber]);
    delete orders[data.orderNumber];
    await FD.saveOrders(orders);
    return {
      type: 'ACK',
      action: 'CLEARED',
      orderNumber: data.orderNumber,
      message: existed
        ? `Commande ${data.orderNumber} retirée de l'extension.`
        : `Commande ${data.orderNumber} absente de l'extension (rien à retirer).`,
    };
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.origin !== FD.FACONOTE_ORIGIN) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.source !== 'faconote') return;

    const requestId = typeof data.requestId === 'string' ? data.requestId.slice(0, 80) : undefined;
    if (data.version !== 1) {
      reply({ type: 'ERROR', requestId, error: `Version de message non gérée : ${String(data.version)}.` });
      return;
    }
    try {
      let result;
      if (data.type === 'CLEAR') result = await handleClear(data);
      else if (data.type === undefined || data.type === 'SEND') result = await handleSend(data);
      else result = { type: 'ERROR', error: `Type de message inconnu : ${String(data.type)}.` };
      reply({ ...result, requestId });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const hint = /context invalidated/i.test(msg) ? ' Extension rechargée : actualisez la page Façonote (F5).' : '';
      reply({ type: 'ERROR', requestId, error: `Erreur de l'extension : ${msg}.${hint}` });
    }
  });
})();
