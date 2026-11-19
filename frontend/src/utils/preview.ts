// Mode préversion (https://faconote.jokinesse.be/preview/) : activé seulement à la compilation
// de la préversion (VITE_PREVIEW=1). Sur le site en ligne, rien ne change.
export const IS_PREVIEW = import.meta.env.VITE_PREVIEW === '1';

// Noms de sauvegarde séparés : la préversion ne lit ni n'efface jamais la commande du site.
export function storageKey(key: string): string {
  return IS_PREVIEW ? `preview.${key}` : key;
}

export const PREVIEW_SEND_DISABLED = 'Préversion : envoi désactivé.';
