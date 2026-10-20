import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function cleanJsonStrings(obj: any): any {
  if (typeof obj === 'string') {
    return obj
      .replace(/\$\\le\$/gi, '≤')
      .replace(/\\le\b/gi, '≤')
      .replace(/\$\\leq\$/gi, '≤')
      .replace(/\\leq\b/gi, '≤')
      .replace(/\$\\ge\$/gi, '≥')
      .replace(/\\ge\b/gi, '≥')
      .replace(/\$/g, '')
      .trim();
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanJsonStrings);
  }
  if (obj && typeof obj === 'object') {
    const res: any = {};
    for (const k of Object.keys(obj)) {
      res[k] = cleanJsonStrings(obj[k]);
    }
    return res;
  }
  return obj;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Gemini API client
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Resilient helper with fallback to latest active models (gemini-3.5-flash & gemini-3.1-flash-lite)
async function callGeminiSafe(params: {
  contents: any;
  systemInstruction?: string;
  responseMimeType?: string;
  temperature?: number;
}): Promise<string> {
  if (!ai) throw new Error('Gemini API client not initialized');
  const models = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
  let lastError: any = null;
  for (const model of models) {
    try {
      const config: any = {};
      if (params.systemInstruction) config.systemInstruction = params.systemInstruction;
      if (params.responseMimeType) config.responseMimeType = params.responseMimeType;
      if (params.temperature !== undefined) config.temperature = params.temperature;

      const res = await ai.models.generateContent({
        model,
        contents: params.contents,
        config,
      });
      if (res && res.text) return res.text;
    } catch (err: any) {
      console.warn(`Gemini call failed with ${model}:`, err?.message || err);
      lastError = err;
    }
  }
  throw lastError || new Error('All Gemini models failed');
}

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    geminiConfigured: !!ai,
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// Mobile Scanner Live Transfer Session Store
// ==========================================
interface MobileTransferSession {
  id: string;
  createdAt: number;
  status: 'waiting' | 'ready';
  imageBase64?: string;
  filename?: string;
  mimeType?: string;
  note?: string;
}

const mobileSessions = new Map<string, MobileTransferSession>();

// Periodic cleanup of sessions older than 45 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of mobileSessions.entries()) {
    if (now - session.createdAt > 45 * 60 * 1000) {
      mobileSessions.delete(id);
    }
  }
}, 60 * 1000);

// Helper to generate a clean short readable code (e.g. FAC-4829)
function generateSessionId(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `FAC-${num}-${rand}`;
}

// 1. Create a new pairing session
app.post('/api/mobile/session', (_req, res) => {
  const sessionId = generateSessionId();
  const session: MobileTransferSession = {
    id: sessionId,
    createdAt: Date.now(),
    status: 'waiting',
  };
  mobileSessions.set(sessionId, session);
  res.json({ sessionId, createdAt: session.createdAt });
});

// 2. Mobile client queries or registers with a session ID
app.get('/api/mobile/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  let session = mobileSessions.get(sessionId);
  if (!session) {
    // If not found, create it on-the-fly so valid codes from direct URL works
    session = {
      id: sessionId,
      createdAt: Date.now(),
      status: 'waiting',
    };
    mobileSessions.set(sessionId, session);
  }
  res.json({
    sessionId: session.id,
    status: session.status,
    hasImage: !!session.imageBase64,
    createdAt: session.createdAt,
  });
});

// 3. Mobile client uploads photo
app.post('/api/mobile/upload', (req, res) => {
  const { sessionId, imageBase64, filename, mimeType, note } = req.body || {};
  if (!sessionId || !imageBase64) {
    return res.status(400).json({ error: 'Identifiant de session et photo requis.' });
  }

  let session = mobileSessions.get(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      createdAt: Date.now(),
      status: 'ready',
    };
    mobileSessions.set(sessionId, session);
  }

  session.status = 'ready';
  session.imageBase64 = imageBase64;
  session.filename = filename || `croquis_mobile_${Date.now()}.jpg`;
  session.mimeType = mimeType || 'image/jpeg';
  session.note = note || '';

  console.log(`[Mobile Transfer] Photo uploaded for session ${sessionId} (${session.filename})`);
  res.json({
    success: true,
    message: 'Photo transmise avec succès au PC',
    sessionId,
  });
});

// 4. PC polls status for uploaded photo
app.get('/api/mobile/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = mobileSessions.get(sessionId);
  if (!session) {
    return res.json({ status: 'not_found' });
  }

  res.json({
    status: session.status,
    imageBase64: session.imageBase64,
    filename: session.filename,
    mimeType: session.mimeType,
    note: session.note,
  });
});

// 5. Reset session (e.g. PC acknowledged and wants to listen for another photo)
app.post('/api/mobile/reset/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = mobileSessions.get(sessionId);
  if (session) {
    session.status = 'waiting';
    delete session.imageBase64;
    delete session.filename;
    delete session.note;
  }
  res.json({ success: true });
});

// PDF / Photo Document Parsing Endpoint for Workshop Pieces Extraction
app.post(['/api/ai/parse-document', '/api/extract-plan'], async (req, res) => {
  try {
    let { fileBase64, mimeType, manualText, standardLength = 2.0 } = req.body || {};

    if (fileBase64 && typeof fileBase64 === 'string') {
      const match = fileBase64.match(/^data:([a-zA-Z0-9\/-]+);base64,/);
      if (match && match[1]) {
        mimeType = match[1];
      }
    }
    if (!mimeType || mimeType === 'image/jpg') {
      mimeType = 'image/jpeg';
    }

    if (!fileBase64 && (!manualText || !manualText.trim())) {
      return res.status(400).json({ error: 'Veuillez fournir un document PDF/image ou un descriptif texte.' });
    }

    if (!ai) {
      // Deterministic fallback if API key is not configured
      const fallbackPieces = [
        {
          id: 'fb-1',
          label: 'Bavette d\'égout',
          dev: 180,
          length: standardLength,
          quantity: 8,
          bends: 2,
          material: 'Zinc Quartz 0.7',
          originalTotalLengthRequested: 15.0,
          workshopSplitReason: `Commande de 15.0m arrondie à 8 pièces de ${standardLength}m (${8 * standardLength}m total, pas de pièce tronquée)`,
        },
        {
          id: 'fb-2',
          label: 'Bande de rive avec pince',
          dev: 250,
          length: standardLength,
          quantity: 8,
          bends: 3,
          material: 'Zinc Quartz 0.7',
          originalTotalLengthRequested: 16.0,
          workshopSplitReason: `Découpé en standard atelier de ${standardLength}m`,
        },
      ];

      return res.json({
        client: 'Client Document Analysé',
        chantier: 'Chantier Extrait',
        detectedMaterial: 'ZINC',
        detectedFinish: 'Quartz-Zinc',
        detectedThickness: '0.7',
        pieces: fallbackPieces,
        notes: 'Analyse locale : configurez votre clé Gemini pour une extraction OCR/multimodale intégrale.',
      });
    }

    const systemPrompt = `Tu es un métreur et chef d'atelier expert chez Facozinc (spécialiste leader du pliage et façonnage sur-mesure de zinc, aluminium, cuivre et plomb pour toitures et bardages).
Ta mission est d'analyser l'image, le plan PDF, le croquis manuscrit ou le bon de commande fourni et d'en extraire avec une EXACTITUDE ABSOLUE la liste de TOUTES les pièces de pliage à réaliser.

RÈGLES D'EXTRACTION VISUELLE ET MÉTIER :

1. CROQUIS / SCHÉMAS DE PROFILS TRACÉS À LA MAIN (Tracés de sections de pliage) :
   - Chaque dessin géométrique représente une pièce façonnée (bavette, rive, noue, couvertine, chéneau, solin, larmier, faîtage, goutte d'eau, etc.).
   - S'IL Y A PLUSIEURS PROFILS SUR LA FEUILLE, EXTRAIS CHAQUE PROFIL COMME UNE PIÈCE SÉPARÉE !
   - DÉVELOPPEMENT TOTAL (dev) :
     * RÈGLE PRIMORDIALE : Si les cotes des ailes ou segments sont annotées le long des traits (ex: une aile de 15, un pan de 120, une retombée de 35, une pince de 20 mm), FAIS LA SOMME EXACTE DE TOUTES LES COTES pour calculer le développement total (ex: 15 + 120 + 35 + 20 = 190 mm).
     * Si le développement total est directement écrit (ex: "Dév 180", "D=250", "Dév. 333", "200 mm"), prends cette valeur en millimètres.
   - COMPTAGE DES PLIS (bends) : Compte le nombre d'angles ou de plis visibles sur le dessin (ex: 2 pour bavette standard, 3 pour rive avec pince, 4 pour couvertine acrotère).
   - QUANTITÉ ET LONGUEUR :
     * Cherche les mentions écrites à côté ou sous chaque croquis (ex: "8 pcs", "x6", "Qté: 10", "8 pces", "4 barres"). Si non précisé, quantité = 1.
     * Cherche les mentions de longueur (ex: "L=2.00m", "3m", "2,50m", "4000 mm" -> 4.0 m). Si non précisé, longueur standard = ${standardLength}m.

2. TABLEAUX, BORDEREAUX DE DÉBIT, DEVIS ET NOTES MANUSCRITES :
   - Lis chaque ligne : associe "Désignation", "Dév (mm)", "Longueur (m)", "Quantité", "Matière / Nuance".
   - Convertis les cotes avec virgule en nombre décimal (ex: 2,0 -> 2.0).
   - Notations abrégées courantes en atelier :
     * "180 / 8*3m" -> dev: 180 mm, quantité: 8, longueur: 3.0 m.
     * "Rive 250 6x2m" -> label: "Bande de rive", dev: 250 mm, quantité: 6, longueur: 2.0 m.
     * "15m de bavette 175" -> 8 pièces standard de 2.0m (16m total, pas de pièce tronquée).

3. MATIÈRES STANDARDS FACOZINC :
   Affecte à chaque pièce le nom exact parmi :
   - Zinc : "Zinc Quartz 0.7", "Zinc Naturel 0.7", "Zinc ATZ 0.7", "Zinc Quartz 0.8", "Zinc Naturel 0.8", "Zinc ATZ 0.8"
   - Aluminium : "Alu Noir RAL 9005 0.7", "Alu Noir RAL 9005 0.8", "Alu Noir RAL 9005 1.0", "Alu Anthracite RAL 7016 0.7", "Alu Anthracite RAL 7016 0.8", "Alu Blanc RAL 9010 0.7", "Alu Blanc RAL 9010 0.8", "Alu QZ 0.7", "Alu QZ 0.8"
   - Cuivre : "Cuivre 0.6"
   - Plomb : "Plomb 1.25"
   (Par défaut si non précisé : "Zinc Quartz 0.7")

Renvoie UNIQUEMENT un objet JSON valide avec cette structure :
{
  "client": "Nom du client ou 'Client Comptoir'",
  "chantier": "Référence chantier ou 'Chantier Toiture'",
  "detectedMaterial": "ZINC" ou "ALUMINIUM",
  "detectedFinish": "Zinc Quartz 0.7" ou autre,
  "detectedThickness": "0.7",
  "pieces": [
    {
      "id": "p-1",
      "label": "Désignation claire (ex: Bavette d'égout, Bande de rive...)",
      "dev": 190,
      "length": 2.0,
      "quantity": 8,
      "bends": 2,
      "material": "Zinc Quartz 0.7",
      "originalTotalLengthRequested": 16.0,
      "workshopSplitReason": "Ailes : 15 + 120 + 35 + 20 = 190 mm · 8 pcs de 2.0m"
    }
  ],
  "rawObservations": "Ce qui a été identifié visuellement sur le croquis/document : nombre de profils, cotes lues, etc.",
  "notes": "Remarques éventuelles de l'atelier"
}`;

    const parts: any[] = [];

    if (fileBase64 && mimeType) {
      parts.push({
        inlineData: {
          mimeType,
          data: fileBase64.replace(/^data:[^;]+;base64,/, ''),
        },
      });
    }

    const textPrompt = manualText
      ? `Analyse ce document ou cette photo avec le texte complémentaire suivant :\n${manualText}`
      : `Analyse avec la plus grande précision ce document / cette photo et extrais toutes les pièces de façonnage.`;

    parts.push({ text: textPrompt });

    let outputText = '{}';
    try {
      outputText = await callGeminiSafe({
        contents: parts,
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        temperature: 0.1,
      });
    } catch (genAiError: any) {
      console.warn('Erreur appel multimodal Gemini :', genAiError?.message);

      // If manual text was supplied, try parsing it
      if (manualText && manualText.trim().length > 0) {
        const textToScan = manualText;
        const lines = textToScan.split('\n').filter((l: string) => l.trim().length > 0);
        const extractedPieces: any[] = [];
        let pieceId = 1;

        for (const line of lines) {
          const lengthMatch = line.match(/([0-9]+(?:[.,][0-9]+)?)\s*(?:m|mètres|metres|ml)\b/i);
          const devMatch = line.match(/(?:dév|dev|largeur|l|d)?\s*([0-9]{2,4})\s*(?:mm)?\b/i);

          if (lengthMatch) {
            const totalReqM = parseFloat(lengthMatch[1].replace(',', '.'));
            let dev = 250;
            if (devMatch) {
              const parsedDev = parseInt(devMatch[1], 10);
              if (parsedDev >= 50 && parsedDev <= 1250) dev = parsedDev;
            }

            let label = 'Pièce façonnée';
            if (/bavette/i.test(line)) label = 'Bavette d\'égout';
            else if (/rive/i.test(line)) label = 'Bande de rive avec pince';
            else if (/noue/i.test(line)) label = 'Noue double pince';
            else if (/couvertine|couvre-mur/i.test(line)) label = 'Couvertine acrotère';
            else if (/ch[eé]neau/i.test(line)) label = 'Chéneau encaissé';
            else if (/solin/i.test(line)) label = 'Solin porte-mastic';

            let pieceMat = 'Zinc Quartz 0.7';
            if (/alu/i.test(line)) {
              if (/noir|9005/i.test(line)) pieceMat = 'Alu Noir RAL 9005 0.7';
              else if (/blanc|9010/i.test(line)) pieceMat = 'Alu Blanc RAL 9010 0.7';
              else if (/7016|anthracite/i.test(line)) pieceMat = 'Alu Anthracite RAL 7016 0.7';
              else pieceMat = 'Alu QZ 0.7';
            }

            const explicitCountMatch = line.match(/([0-9]+)\s*(?:pcs|pi[èe]ces|morceaux|barres)\b/i);
            const stdLen = Number(standardLength) || 2.0;

            if (explicitCountMatch) {
              const count = parseInt(explicitCountMatch[1], 10);
              extractedPieces.push({
                id: `p-${pieceId++}`,
                label,
                dev,
                length: stdLen,
                quantity: count,
                bends: 2,
                material: pieceMat,
                originalTotalLengthRequested: count * stdLen,
                workshopSplitReason: `${count} pièces standard de ${stdLen}m`,
              });
            } else {
              const count = Math.max(1, Math.ceil(totalReqM / stdLen));
              extractedPieces.push({
                id: `p-${pieceId++}`,
                label,
                dev,
                length: stdLen,
                quantity: count,
                bends: 2,
                material: pieceMat,
                originalTotalLengthRequested: totalReqM,
                workshopSplitReason: `Commande de ${totalReqM}m arrondie à ${count} pièces de ${stdLen}m`,
              });
            }
          }
        }

        return res.json(cleanJsonStrings({
          client: 'Client Toiture',
          chantier: 'Chantier Bordereau',
          detectedMaterial: /alu/i.test(textToScan) ? 'ALUMINIUM' : 'ZINC',
          detectedFinish: 'Zinc Quartz 0.7',
          detectedThickness: '0.7',
          pieces: extractedPieces,
          notes: 'Extraction réalisée sur le texte fourni.',
        }));
      }

      // If it was purely an image and failed
      return res.status(422).json({
        error: `Impossible d'analyser l'image : ${genAiError?.message || 'Erreur lors de la reconnaissance'}. Assurez-vous que l'image est nette et bien orientée.`,
      });
    }

    let parsed: any;
    try {
      const cleaned = outputText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(422).json({
        error: 'Le format de réponse de l\'IA n\'a pas pu être interprété.',
        raw: outputText,
      });
    }

    // Clean and validate extracted pieces
    if (!parsed.pieces || !Array.isArray(parsed.pieces)) {
      parsed.pieces = [];
    }

    parsed.pieces = parsed.pieces.map((p: any, idx: number) => {
      const dev = Math.max(20, Math.min(2000, Number(p.dev) || 150));
      const length = Math.max(0.2, Math.min(14, Number(p.length) || 2.0));
      const quantity = Math.max(1, Math.min(1000, Math.round(Number(p.quantity) || 1)));
      const bends = Math.max(0, Math.min(20, Math.round(Number(p.bends) || 2)));
      return {
        id: p.id || `p-ext-${idx + 1}-${Date.now()}`,
        label: p.label || `Façonnage Dév ${dev}mm`,
        dev,
        length: Math.round(length * 100) / 100,
        quantity,
        bends,
        material: p.material || parsed.detectedFinish || 'Zinc Quartz 0.7',
        workshopSplitReason: p.workshopSplitReason || `Extrait du document`,
      };
    });

    res.json(cleanJsonStrings(parsed));
  } catch (error: any) {
    console.error('Erreur analyse document Gemini:', error);
    res.status(500).json({
      error: 'Erreur lors de l\'analyse du document par l\'IA',
      details: error?.message || 'Erreur inconnue',
    });
  }
});

// AI Optimization & Workshop Expert Advisory Endpoint
app.post('/api/ai/optimize-cutting', async (req, res) => {
  try {
    const { order, pieces, cuts, scraps, materialsUsed } = req.body;

    if (!pieces || !Array.isArray(pieces) || pieces.length === 0) {
      return res.status(400).json({ error: 'Aucune pièce fournie pour l\'analyse.' });
    }

    if (!ai) {
      // Fallback response if API key is not configured
      return res.json({
        analysis: "Analyse algorithmique interne effectuée avec succès. L'IA Gemini apportera des recommandations expertes complémentaires dès que la clé sera configurée.",
        recommendations: [
          "Respectez une température minimale d'atelier de 10°C pour le façonnage du zinc afin d'éviter le micro-cisaillage lors du pliage.",
          "Priorisez la découpe des grandes longueurs (> 3m) sur les bobines neuves pour minimiser les raccords.",
          "Stockez les chutes réutilisables à plat ou verticalement sur rack protégé pour éviter l'oxydation prématurée ou les rayures sur l'alu laqué."
        ],
        bendingAdvice: "Exécutez en premier les plis d'égout et pinces doubles avant les plis d'angle supérieurs.",
      });
    }

    const prompt = `Tu es un maître artisan zingueur et chef d'atelier de façonnage chez Facozinc (expert toiture, zinc et aluminium).
Analyse les données suivantes de commande de façonnage et de découpe :

Détails de la commande :
- Client / Chantier : ${order?.client || 'Non spécifié'} - ${order?.chantier || 'Non spécifié'}
- Matière : ${order?.material || 'Zinc'} (${order?.finish || 'Naturel'}, épaisseur ${order?.thickness || '0.8'} mm)
- Liste des pièces à façonner :
${pieces.map((p: any, i: number) => `  ${i + 1}. ${p.label || 'Pièce'} : Dév ${p.dev} mm x Longueur ${p.length} m (Qté: ${p.quantity || 1}) - ${p.bends || 0} plis`).join('\n')}

Plan de débit calculé par l'algorithme :
- Matières mères utilisées (bobines/feuilles) : ${JSON.stringify(materialsUsed || [])}
- Chutes réutilisables générées : ${JSON.stringify(scraps || [])}

Rédige une synthèse professionnelle concise au format JSON avec les clés suivantes :
1. "summary" : Synthèse en 2-3 phrases sur l'efficacité de la découpe et la valorisation matière.
2. "workshopTips" : Une liste de 3 à 4 conseils pratiques d'atelier très précis pour l'opérateur (ex: sens de laminage, précaution température pour pliage zinc >= 10°C, protection de la laque alu, ordre de passage sur la plieuse).
3. "reuseStrategy" : Conseils sur le stockage et la réutilisation immédiate des chutes générées.
4. "safetyNotice" : 1 consigne de manutention/sécurité essentielle (arêtes vives, port de gants anti-coupure, manutention des bobines).

Réponds uniquement en JSON valide conforme à cette structure.`;

    const text = await callGeminiSafe({
      contents: prompt,
      responseMimeType: 'application/json',
    });
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { summary: text, workshopTips: [], reuseStrategy: '', safetyNotice: '' };
    }

    res.json(cleanJsonStrings(parsed));
  } catch (error: any) {
    console.error('Erreur optimisation Gemini:', error);
    res.status(500).json({
      error: 'Erreur lors de la génération de l\'analyse IA',
      details: error?.message || 'Erreur inconnue',
    });
  }
});

// Gemini Workshop Advisory endpoint (used by OptimizerTab for direct recommendations)
app.post('/api/gemini-advisor', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt manquant.' });
    }

    if (!ai) {
      return res.json({
        text: `Conseils Atelier Facozinc :
• Refendre en premier les largeurs les plus importantes pour stabiliser la bande dans la cisaille.
• Température atelier minimum 10°C pour éviter les micro-fissures sur le zinc.
• Vérifier le jeu de refente : molettes affûtées pour éviter toute amorce de déchirure sur les plis serrés.
• Protéger les faces laquées de l'aluminium avec film protecteur ou feutrine lors du glissement sur table.`,
      });
    }

    const text = await callGeminiSafe({
      contents: prompt,
    });

    res.json({ text: text || '' });
  } catch (error: any) {
    console.warn('Gemini advisor fallback:', error?.message);
    res.json({
      text: `Conseils Atelier Facozinc :
• Refendre en premier les largeurs les plus importantes pour stabiliser la bande dans la cisaille.
• Température atelier minimum 10°C pour éviter les micro-fissures sur le zinc.
• Vérifier le jeu de refente : molettes affûtées pour éviter toute amorce de déchirure sur les plis serrés.`,
    });
  }
});

async function startServer() {
  const distPath = path.resolve(__dirname, 'dist');
  const hasDist = fs.existsSync(path.resolve(distPath, 'index.html'));
  const isDev = process.env.NODE_ENV === 'development' || (!hasDist && process.env.NODE_ENV !== 'production');

  if (isDev) {
    console.log('Starting Facozinc in development mode with Vite middleware');
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log(`Starting Facozinc in production mode, serving ${distPath}`);
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );

    // Explicit 404 for missing assets under /assets to prevent returning index.html as text/html for CSS/JS
    app.use('/assets', (_req, res) => {
      res.status(404).type('text/plain').send('Asset not found');
    });

    // SPA wildcard: only deliver index.html for page navigation requests (no file extension)
    app.get('*', (req, res) => {
      if (path.extname(req.path)) {
        res.status(404).type('text/plain').send('File not found');
        return;
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Facozinc applet server running on port ${PORT} (${isDev ? 'development' : 'production'})`);
  });
}

startServer();
