"use client";

import * as React from "react";
import { BellRing } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/lib/actions/push";
import { StatusLine, useFamilyAction } from "./use-family-action";

type Support = "checking" | "supported" | "unsupported" | "ios-install";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function detectSupport(): Support {
  if (typeof window === "undefined") return "checking";
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const hasApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // iOS / iPadOS 16.4+: Web Push only for apps added to the Home Screen.
  if (isIos && !standalone) return "ios-install";
  return hasApi ? "supported" : "unsupported";
}

/** Opt in / out of push notifications on THIS device, for the current club. */
export function PushOptInClient({ vapidPublicKey }: { vapidPublicKey: string }) {
  const t = useT();
  const { busy, msg, run, setMsg } = useFamilyAction();
  const [support, setSupport] = React.useState<Support>("checking");
  const [endpoint, setEndpoint] = React.useState<string | null>(null);
  const [permission, setPermission] = React.useState<NotificationPermission | "default">("default");

  React.useEffect(() => {
    const s = detectSupport();
    setSupport(s);
    if (s !== "supported") return;
    setPermission(Notification.permission);
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then(async (sub) => {
        setEndpoint(sub?.endpoint ?? null);
        // Re-register an existing device for the current club (one login, several clubs).
        if (sub && Notification.permission === "granted") {
          const json = sub.toJSON();
          if (json.keys?.p256dh && json.keys.auth) {
            await savePushSubscription({ endpoint: sub.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, userAgent: navigator.userAgent.slice(0, 300) });
          }
        }
      })
      .catch(() => undefined);
  }, []);

  async function enable() {
    setMsg(null);
    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== "granted") return setMsg({ ok: false, text: t("family.push.optIn.denied") });
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource });
    }
    const json = sub.toJSON();
    if (!json.keys?.p256dh || !json.keys.auth) return setMsg({ ok: false, text: t("family.errors.generic") });
    const s = sub;
    await run(
      () => savePushSubscription({ endpoint: s.endpoint, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! }, userAgent: navigator.userAgent.slice(0, 300) }),
      () => setEndpoint(s.endpoint),
    );
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    const ep = sub?.endpoint ?? endpoint;
    if (sub) await sub.unsubscribe().catch(() => undefined);
    if (ep) await run(() => removePushSubscription(ep), () => setEndpoint(null));
    else setEndpoint(null);
  }

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <BellRing aria-hidden className="h-4 w-4 text-brand-primary" />
        <CardTitle>{t("family.push.optIn.title")}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3 text-sm text-text-secondary">
        <p>{t("family.push.optIn.intro")}</p>
        {support === "ios-install" && <p className="rounded-md border border-border bg-surface p-3 text-text">{t("family.push.optIn.iosInstall")}</p>}
        {support === "unsupported" && <p className="text-text-muted">{t("family.push.optIn.unsupported")}</p>}
        {support === "supported" && permission === "denied" && <p className="text-warning">{t("family.push.optIn.blocked")}</p>}
        {support === "supported" && (
          <div className="flex flex-wrap gap-2">
            {endpoint ? (
              <>
                <Button variant="secondary" onClick={disable} loading={busy} disabled={busy}>{t("family.push.optIn.disable")}</Button>
                <Button variant="ghost" onClick={() => run(() => sendTestPush())} disabled={busy}>{t("family.push.optIn.test")}</Button>
              </>
            ) : (
              <Button onClick={enable} loading={busy} disabled={busy || permission === "denied"}>{t("family.push.optIn.enable")}</Button>
            )}
          </div>
        )}
        <p className="text-xs text-text-muted">{t("family.push.optIn.platforms")}</p>
        <StatusLine msg={msg} />
      </CardBody>
    </Card>
  );
}
