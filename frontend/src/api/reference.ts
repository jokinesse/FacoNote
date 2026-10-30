import { useEffect, useState } from 'react';
import { optimizerApi } from './optimizerApi';
import { ReferenceResponse } from './types';

// Données de référence atelier (matières, largeurs de bobines, bornes), fournies par le backend.
// Chargées une seule fois par page, puis partagées entre les composants.
let referencePromise: Promise<ReferenceResponse> | null = null;

export function loadReference(): Promise<ReferenceResponse> {
  if (!referencePromise) {
    referencePromise = optimizerApi
      .getReference()
      .then((res) => res.data)
      .catch((err) => {
        referencePromise = null; // nouvel essai au prochain appel
        throw err;
      });
  }
  return referencePromise;
}

export function useReference(): ReferenceResponse | null {
  const [reference, setReference] = useState<ReferenceResponse | null>(null);
  useEffect(() => {
    let active = true;
    loadReference()
      .then((data) => {
        if (active) setReference(data);
      })
      .catch(() => {
        // Sans référence, l'interface garde les choix par défaut du backend
      });
    return () => {
      active = false;
    };
  }, []);
  return reference;
}
