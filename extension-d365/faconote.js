// Content script sur https://faconote.jokinesse.be : reçoit les envois de Façonote (postMessage),
// les valide, les range dans chrome.storage.local et répond ACK ou ERROR à la page.
'use strict';

(() => {
  if (window.top !== window) return;

  const MAX_GROUPS = 30;
  const MAX_TEXT = 100;
  const MAX_LENGTH_M = 100000;
  const MAX_COILS = 20;
  const MAX_WIDTH_MM = 5000;

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

  // Nombre fini dans les bornes, au plus 2 décimales (format D365). Contrôle de forme seulement.
  const TWO_DECIMALS_RE = /^\d+(\.\d{1,2})?$/;
  function isQuantity(v, allowZero) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v > MAX_LENGTH_M) return false;
    if (allowZero ? v < 0 : !(v > 0)) return false;
    return TWO_DECIMALS_RE.test(String(v));
  }

  // Message version 2 : pièces (DEV) et bobines de la même matière. Renvoie un message d'erreur, ou null.
  function checkGroupV2(g, i) {
    const where = `Groupe ${i + 1}`;
    if (!g || typeof g !== 'object') return `${where} : format invalide.`;
    if (!isText(g.material)) return `${where} : « material » manquant.`;
    const w = `${where} (${g.material})`;
    if (typeof g.has_pieces !== 'boolean') return `${w} : « has_pieces » manquant.`;
    if (g.has_pieces) {
      if (!isText(g.matiere)) return `${w} : « matiere » manquante.`;
      if (!isText(g.epaisseur)) return `${w} : « epaisseur » manquante.`;
    } else {
      if (g.matiere !== null && g.matiere !== undefined && !isText(g.matiere)) return `${w} : « matiere » invalide.`;
      if (g.epaisseur !== null && g.epaisseur !== undefined && !isText(g.epaisseur)) return `${w} : « epaisseur » invalide.`;
    }
    // Longueurs DEV : mêmes contrôles qu'en version 1
    const lengthsErr = checkGroup({ material: g.material, matiere: 'x', epaisseur: 'x', lengths: g.lengths }, i);
    if (lengthsErr) return lengthsErr;
    if (!g.has_pieces && FD.BOUNDS.some((b) => g.lengths[String(b)] !== 0)) {
      return `${w} : longueurs DEV non nulles alors que la matière n'a pas de pièce.`;
    }

    if (!Array.isArray(g.coils) || g.coils.length > MAX_COILS) return `${w} : « coils » invalide (0 à ${MAX_COILS} lignes).`;
    const coilArticles = new Set();
    for (const [j, c] of g.coils.entries()) {
      const wc = `${w}, bobine ${j + 1}`;
      if (!c || typeof c !== 'object') return `${wc} : format invalide.`;
      if (typeof c.article !== 'string' || !FD.AR_RE.test(c.article)) return `${wc} : code article invalide (attendu AR + 8 chiffres).`;
      if (!Number.isInteger(c.width_mm) || c.width_mm < 1 || c.width_mm > MAX_WIDTH_MM) return `${wc} : largeur invalide.`;
      if (!isQuantity(c.quantity_m, false)) return `${wc} : quantité invalide (plus de 0, au plus ${MAX_LENGTH_M} m, 2 décimales).`;
      // 0.4.6 : poids calculé par le backend pour les codes saisis en kilos dans D365 (null = saisie en mètres)
      if (c.quantity_kg != null && !isQuantity(c.quantity_kg, false)) return `${wc} : poids invalide (plus de 0, 2 décimales).`;
      if (coilArticles.has(c.article)) return `${w} : code ${c.article} en double.`;
      coilArticles.add(c.article);
    }
    if (!isQuantity(g.chute_m, true)) return `${w} : « chute_m » invalide (0 à ${MAX_LENGTH_M} m, 2 décimales).`;

    if (!Array.isArray(g.all_articles) || g.all_articles.length > MAX_COILS) {
      return `${w} : « all_articles » invalide (0 à ${MAX_COILS} codes).`;
    }
    const all = new Set();
    for (const a of g.all_articles) {
      if (typeof a !== 'string' || !FD.AR_RE.test(a)) return `${w} : code article invalide dans « all_articles ».`;
      if (all.has(a)) return `${w} : code ${a} en double dans « all_articles ».`;
      all.add(a);
    }
    for (const a of coilArticles) if (!all.has(a)) return `${w} : ${a} absent de « all_articles ».`;
    const hasCoilPart = g.coils.length > 0 || g.chute_m > 0;
    if (!all.size && hasCoilPart) return `${w} : bobines ou chute sans code article de la matière.`;
    if (!g.has_pieces && !hasCoilPart) return `${w} : ni pièce, ni bobine, ni chute.`;
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
    const v2 = data.version === 2;
    const seen = new Set();
    const articleOwner = new Map(); // code AR -> matière : un code ne peut servir qu'à une matière
    for (let i = 0; i < groups.length; i++) {
      const err = v2 ? checkGroupV2(groups[i], i) : checkGroup(groups[i], i);
      if (err) return { type: 'ERROR', error: err };
      const key = groups[i].material.trim();
      if (seen.has(key)) return { type: 'ERROR', error: `Matière en double : ${key}.` };
      seen.add(key);
      if (v2) {
        for (const a of groups[i].all_articles) {
          if (articleOwner.has(a)) return { type: 'ERROR', error: `Code ${a} en double : ${articleOwner.get(a)} et ${key}.` };
          articleOwner.set(a, key);
        }
      }
    }

    const order = {
      orderNumber: data.orderNumber,
      sentAt: typeof data.sentAt === 'string' ? data.sentAt.slice(0, 40) : null,
      receivedAt: new Date().toISOString(),
      groups: groups.map((g) => {
        const hasPieces = v2 ? g.has_pieces : true;
        const coils = v2 ? g.coils.map((c) => ({ width_mm: c.width_mm, article: c.article, quantity_m: c.quantity_m, quantity_kg: c.quantity_kg != null ? c.quantity_kg : null })) : [];
        const chute = v2 ? g.chute_m : 0;
        return {
          material: g.material.trim(),
          matiere: typeof g.matiere === 'string' ? g.matiere.trim() : null,
          epaisseur: typeof g.epaisseur === 'string' ? g.epaisseur.trim() : null,
          lengths: Object.fromEntries(FD.BOUNDS.map((b) => [String(b), g.lengths[String(b)]])),
          // un renvoi remet toutes les matières « à faire » ; sans pièce, la partie DEV n'a rien à faire
          done: !hasPieces,
          doneAt: null,
          has_pieces: hasPieces,
          coils,
          all_articles: v2 ? [...g.all_articles] : [],
          chute_m: chute,
          coilsDone: coils.length === 0 && !(chute > 0),
          coilsDoneAt: null,
        };
      }),
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
      message: `${replaced ? 'Commande remplacée' : 'Commande reçue'} : ${order.orderNumber} (${order.groups.length} matière${order.groups.length > 1 ? 's' : ''}${v2 ? ', avec bobines' : ''}).`,
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
        ? `Commande ${data.orderNumber} vidée de l'extension.`
        : `Commande ${data.orderNumber} absente de l'extension (rien à vider).`,
    };
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.origin !== FD.FACONOTE_ORIGIN) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.source !== 'faconote') return;

    const requestId = typeof data.requestId === 'string' ? data.requestId.slice(0, 80) : undefined;
    if (data.version !== 1 && data.version !== 2) {
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
