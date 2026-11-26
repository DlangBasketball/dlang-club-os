"use client";

import { isBeforeInstallPromptEvent, type BeforeInstallPromptEvent } from "@/lib/pwa/install";

/**
 * Holds Chromium's `beforeinstallprompt` event. The listener is attached when
 * this module first loads (it is imported by <PwaRegister/> in the root
 * layout), so the event is not missed while a page is still hydrating.
 */
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    if (!isBeforeInstallPromptEvent(e)) return;
    // Suppress the browser mini-infobar; our own "Install app" button shows instead.
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferred;
}

/** The prompt can be used once; drop it afterwards. */
export function clearDeferredPrompt(): void {
  deferred = null;
  notify();
}

export function subscribeInstallPrompt(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
