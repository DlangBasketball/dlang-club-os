"use client";
import * as React from "react";
import { basketStorageKey, emptyBasket, loadBasket, saveBasket, type Basket } from "@/lib/camps/basket";

/**
 * The camp basket of this device for one scope (club + mode, e.g.
 * "parent:<org>"), kept in localStorage until checkout and shared between
 * tabs. Health notes typed for a new child stay in memory only.
 */
export function useCampBasket(scope: string) {
  const [basket, setBasket] = React.useState<Basket>(emptyBasket);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setBasket(loadBasket(scope));
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== basketStorageKey(scope)) return;
      const stored = loadBasket(scope);
      // keep the in-memory health notes of children that are still there
      setBasket((prev) => ({
        ...stored,
        children: stored.children.map((c) => {
          const p = prev.children.find((x) => x.ref === c.ref);
          return p ? { ...c, allergies: p.allergies, conditions: p.conditions, medicalNotes: p.medicalNotes } : c;
        }),
      }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [scope]);

  const update = React.useCallback((fn: (b: Basket) => Basket) => {
    setBasket((prev) => {
      const next = fn(prev);
      saveBasket(scope, next);
      return next;
    });
  }, [scope]);

  const clear = React.useCallback(() => update(() => emptyBasket()), [update]);

  return { basket, ready, update, clear };
}
