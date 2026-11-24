"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ModalDialog } from "@/components/attendance/coach/modal-dialog";

/**
 * ModalDialog rendered into document.body. The participant dialogs open from
 * inside booking forms (camp, training): a portal keeps their inputs out of
 * the outer <form>, so Enter in the dialog never submits the booking and the
 * booking's state is untouched.
 */
export function PortalDialog(props: React.ComponentProps<typeof ModalDialog>) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<ModalDialog {...props} />, document.body);
}

/** One request id per user intent: kept across retries, renewed after a completed action. */
export function useRequestId(): [() => string, () => void] {
  const ref = React.useRef<string>("");
  const get = React.useCallback(() => {
    if (!ref.current) ref.current = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : fallbackUuid();
    return ref.current;
  }, []);
  const reset = React.useCallback(() => { ref.current = ""; }, []);
  return [get, reset];
}

function fallbackUuid(): string {
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
