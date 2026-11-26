"use client";

import * as React from "react";
import { Sun, X } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { CourtsideCardData } from "@/lib/member-cards/courtside";
import { cn } from "@/lib/utils";
import { CourtsideCard, type CourtsideLabels } from "./courtside-card";

/**
 * The athlete's Courtside card(s). When the athlete is eligible under two
 * billing entities there is one card per brand: tabs above the card, and a
 * horizontal swipe switches between them. The QR opens full screen for the
 * coach's scanner (large code, name, brightness hint).
 */
export function CourtsideDeck({ card, className }: { card: CourtsideCardData; className?: string }) {
  const t = useT();
  const [index, setIndex] = React.useState(0);
  const [enlarged, setEnlarged] = React.useState(false);
  const touch = React.useRef<{ x: number; y: number } | null>(null);
  const tabsId = React.useId();
  const brands = card.brands;
  const brand = brands[Math.min(index, brands.length - 1)];
  if (!brand) return null;

  const labels: CourtsideLabels = {
    member: t("memberCard.memberLabel"),
    title: t("memberCard.cardTitle"), checkIn: t("memberCard.checkInHint"), tapToEnlarge: t("memberCard.tapToEnlarge"),
    enlargeQr: t("memberCard.enlargeQr"),
    inactive: t("memberCard.inactive"),
    photoAlt: t("athletePhoto.alt", { name: card.name }),
    cardAria: t("memberCard.cardAria", { name: card.name, brand: brand.displayName }),
  };

  const go = (next: number) => setIndex((next + brands.length) % brands.length);
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s || brands.length < 2) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
  };

  return (
    <div className={cn("w-full max-w-[30rem]", className)}>
      {brands.length > 1 && (
        <div role="tablist" aria-label={t("memberCard.switchBrand")} className="mb-3 flex gap-1 rounded-lg border border-border bg-surface-elevated p-1">
          {brands.map((b, i) => (
            <button key={b.entityId ?? i} type="button" role="tab" id={`${tabsId}-tab-${i}`} aria-selected={i === index}
              aria-controls={`${tabsId}-panel`} tabIndex={i === index ? 0 : -1}
              onClick={() => setIndex(i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
                if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
              }}
              className={cn("min-w-0 flex-1 truncate rounded-md px-3 py-1.5 text-sm transition",
                i === index ? "bg-brand-primary text-on-brand" : "text-text-muted hover:text-text")}>
              {b.displayName}
            </button>
          ))}
        </div>
      )}
      <div id={`${tabsId}-panel`} role={brands.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={brands.length > 1 ? `${tabsId}-tab-${index}` : undefined}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="touch-pan-y">
        <CourtsideCard brand={brand} name={card.name} photoUrl={card.photoUrl} qrSvg={card.qrSvg} cardActive={card.cardActive} showQr={card.checkIn}
          labels={labels} onEnlarge={() => setEnlarged(true)} />
      </div>
      {brands.length > 1 && (
        <p className="mt-2 text-center text-xs text-text-muted">{t("memberCard.swipeHint", { current: index + 1, total: brands.length })}</p>
      )}
      <QrFullScreen open={enlarged} onClose={() => setEnlarged(false)} name={card.name} brand={brand.displayName} qrSvg={card.qrSvg} />
    </div>
  );
}

function QrFullScreen({ open, onClose, name, brand, qrSvg }: {
  open: boolean; onClose: () => void; name: string; brand: string; qrSvg: string | null;
}) {
  const t = useT();
  const ref = React.useRef<HTMLDialogElement>(null);
  const id = React.useId();

  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Keep the screen awake while the code is shown (where the browser allows it).
  React.useEffect(() => {
    if (!open) return;
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (k: "screen") => Promise<Sentinel> } };
    let lock: Sentinel | null = null;
    nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => { /* not allowed: fine */ });
    return () => { void lock?.release().catch(() => undefined); };
  }, [open]);

  return (
    <dialog ref={ref} aria-labelledby={`${id}-name`} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      className="m-0 h-[100dvh] max-h-none w-screen max-w-none bg-card-qr p-0 text-card-qr-ink backdrop:bg-black/80">
      {open && (
        <div className="flex h-full flex-col items-center justify-center gap-5 px-4 py-8">
          <button type="button" onClick={onClose} aria-label={t("memberCard.close")}
            className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-card-qr-ink/20 text-card-qr-ink">
            <X className="h-6 w-6" aria-hidden />
          </button>
          <p className="flex items-center gap-2 text-sm text-card-qr-ink/70"><Sun className="h-4 w-4" aria-hidden /> {t("memberCard.brightnessHint")}</p>
          {qrSvg && (
            <div role="img" aria-label={t("sports.cards.qrAlt")}
              className="aspect-square w-[min(86vw,70dvh,30rem)] [&_svg]:h-full [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: qrSvg }} />
          )}
          <div className="text-center">
            <p id={`${id}-name`} className="font-display text-2xl font-semibold [overflow-wrap:anywhere]">{name}</p>
            <p className="text-sm text-card-qr-ink/70">{brand}</p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-full border border-card-qr-ink/30 px-6 py-2.5 text-sm font-medium text-card-qr-ink">{t("memberCard.close")}</button>
        </div>
      )}
    </dialog>
  );
}
