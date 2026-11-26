"use client";

/**
 * Page-wide "unsaved changes" tracker (role switcher, and anything else that
 * leaves the page on purpose). An edit inside a form marks the page dirty;
 * submitting it, or moving to another page, clears it. Search / filter forms
 * (method GET, role="search") and fields marked data-no-dirty never count.
 */
let dirty = false;
let installed = false;

function counts(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (!el.matches("input, textarea, select, [contenteditable='true']")) return false;
  if (el.closest("[data-no-dirty], header, nav, [role='search']")) return false;
  if (el instanceof HTMLInputElement && ["search", "hidden", "button", "submit"].includes(el.type)) return false;
  const form = el.closest("form");
  if (!form) return false;
  if ((form.getAttribute("method") ?? "").toLowerCase() === "get") return false;
  return true;
}

export function installUnsavedTracker(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const mark = (e: Event) => { if (counts(e.target)) dirty = true; };
  document.addEventListener("input", mark, true);
  document.addEventListener("change", mark, true);
  document.addEventListener("submit", () => { dirty = false; }, true);
}

export function hasUnsavedChanges(): boolean {
  return dirty;
}

export function markClean(): void {
  dirty = false;
}
