"use client";

import * as React from "react";
import { Camera, CameraOff, Nfc, ScanLine } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { resolveScan } from "@/lib/actions/member-cards";
import { barcodeDetector, hasCamera, nfcReader, ndefText, type NdefReadingEvent } from "@/lib/member-cards/browser";

/**
 * Roll call by member card: phone camera (BarcodeDetector) reading the QR
 * code, Web NFC (Android Chrome) reading a bracelet / tag, or typing the
 * code as a fallback. Every scan is resolved server-side (own club, athletes
 * the coach may access only); the roster decides what "present" means.
 */
export function RollCallScanner({ onResolved, disabled }: {
  onResolved: (athleteId: string, name: string) => "marked" | "notOnRoster";
  disabled?: boolean;
}) {
  const t = useT();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const nfcAbort = React.useRef<AbortController | null>(null);
  const lastRef = React.useRef<{ value: string; at: number } | null>(null);
  const [camOn, setCamOn] = React.useState(false);
  const [nfcOn, setNfcOn] = React.useState(false);
  const [support, setSupport] = React.useState({ camera: false, detector: false, nfc: false });
  const [manual, setManual] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    setSupport({ camera: hasCamera(), detector: barcodeDetector() !== null, nfc: nfcReader() !== null });
    return () => {
      stopCamera();
      nfcAbort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handle = React.useCallback(async (raw: string) => {
    const now = Date.now();
    if (lastRef.current && lastRef.current.value === raw && now - lastRef.current.at < 4000) return;
    lastRef.current = { value: raw, at: now };
    const res = await resolveScan(raw);
    if (!res.ok || !res.data) { setMsg({ ok: false, text: res.ok ? t("sports.cards.errors.unknownCard") : res.error }); return; }
    const outcome = onResolved(res.data.athleteId, res.data.name);
    setMsg(outcome === "marked"
      ? { ok: true, text: t("sports.rollCall.marked", { name: res.data.name }) }
      : { ok: false, text: t("sports.rollCall.notOnRoster", { name: res.data.name }) });
    if (outcome === "marked" && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(80);
  }, [onResolved, t]);

  function stopCamera() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setCamOn(false);
  }

  async function startCamera() {
    const detector = barcodeDetector();
    if (!detector) { setMsg({ ok: false, text: t("sports.rollCall.noDetector") }); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCamOn(true);
      setMsg({ ok: true, text: t("sports.rollCall.pointCamera") });
      timerRef.current = window.setInterval(async () => {
        const v = videoRef.current;
        if (!v || v.readyState < 2) return;
        try {
          const codes = await detector.detect(v);
          if (codes[0]?.rawValue) void handle(codes[0].rawValue);
        } catch {
          /* keep scanning */
        }
      }, 350);
    } catch {
      setMsg({ ok: false, text: t("sports.rollCall.cameraDenied") });
      stopCamera();
    }
  }

  async function toggleNfc() {
    if (nfcOn) { nfcAbort.current?.abort(); setNfcOn(false); return; }
    const reader = nfcReader();
    if (!reader) { setMsg({ ok: false, text: t("sports.cards.nfcUnsupported") }); return; }
    const ctrl = new AbortController();
    nfcAbort.current = ctrl;
    try {
      await reader.scan({ signal: ctrl.signal });
      reader.addEventListener("reading", (e) => {
        const ev = e as NdefReadingEvent;
        const value = ndefText(ev) ?? ev.serialNumber ?? "";
        if (value) void handle(value);
      });
      setNfcOn(true);
      setMsg({ ok: true, text: t("sports.cards.nfcHold") });
    } catch {
      setMsg({ ok: false, text: t("sports.cards.nfcFailed") });
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ScanLine className="h-4 w-4 text-brand-primary" aria-hidden />
        <span className="text-sm font-medium">{t("sports.rollCall.title")}</span>
        <div className="flex-1" />
        {support.camera && (
          <Button size="sm" variant={camOn ? "secondary" : "outline"} disabled={disabled} onClick={() => (camOn ? stopCamera() : startCamera())}>
            {camOn ? <CameraOff className="h-4 w-4" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
            {camOn ? t("sports.rollCall.stopCamera") : t("sports.rollCall.scanQr")}
          </Button>
        )}
        {support.nfc && (
          <Button size="sm" variant={nfcOn ? "secondary" : "outline"} disabled={disabled} onClick={toggleNfc}>
            <Nfc className="h-4 w-4" aria-hidden /> {nfcOn ? t("sports.rollCall.stopNfc") : t("sports.rollCall.tapNfc")}
          </Button>
        )}
      </div>
      <video ref={videoRef} playsInline muted className={camOn ? "mt-3 aspect-video w-full rounded-lg bg-black object-cover" : "hidden"} />
      {!support.detector && <p className="mt-2 text-xs text-text-muted">{t("sports.rollCall.noDetector")}</p>}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { lastRef.current = null; void handle(manual.trim()); setManual(""); } }}>
        <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={t("sports.rollCall.manualPlaceholder")}
          aria-label={t("sports.rollCall.manualPlaceholder")} maxLength={120} disabled={disabled} className="font-mono" />
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || !manual.trim()}>{t("sports.rollCall.check")}</Button>
      </form>
      {msg && <p role={msg.ok ? "status" : "alert"} aria-live="polite" className={msg.ok ? "mt-2 text-sm text-success" : "mt-2 text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}
