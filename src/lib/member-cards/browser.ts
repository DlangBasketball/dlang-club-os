/**
 * Browser capability helpers for roll call (feature detection only; every
 * caller has a fallback): the BarcodeDetector API (Chrome / Android / Safari
 * 17+) and Web NFC (Chrome on Android). Typed minimally here because the DOM
 * lib does not ship these interfaces yet.
 */
export type DetectedBarcode = { rawValue: string };
export type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

export type NdefRecord = { recordType: string; data?: DataView; encoding?: string };
export type NdefReadingEvent = Event & { serialNumber?: string; message?: { records: NdefRecord[] } };
export type NdefReaderLike = EventTarget & {
  scan(opts?: { signal?: AbortSignal }): Promise<void>;
  write(message: string | { records: { recordType: string; data: string }[] }, opts?: { signal?: AbortSignal }): Promise<void>;
};
type NdefReaderCtor = new () => NdefReaderLike;

type W = typeof globalThis & { BarcodeDetector?: BarcodeDetectorCtor; NDEFReader?: NdefReaderCtor };

export function barcodeDetector(): BarcodeDetectorLike | null {
  const g = globalThis as W;
  if (typeof g.BarcodeDetector !== "function") return null;
  try {
    return new g.BarcodeDetector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

export function hasCamera(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export function nfcReader(): NdefReaderLike | null {
  const g = globalThis as W;
  if (typeof g.NDEFReader !== "function") return null;
  try {
    return new g.NDEFReader();
  } catch {
    return null;
  }
}

/** Text of the first text / URL record of an NFC message. */
export function ndefText(event: NdefReadingEvent): string | null {
  for (const r of event.message?.records ?? []) {
    if ((r.recordType === "text" || r.recordType === "url") && r.data) {
      try {
        return new TextDecoder(r.encoding || "utf-8").decode(r.data);
      } catch {
        /* next record */
      }
    }
  }
  return null;
}
