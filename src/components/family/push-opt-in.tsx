import { pushPublicKey } from "@/lib/push/send";
import { PushOptInClient } from "./push-opt-in-client";

/**
 * Web Push opt-in card (parent and coach apps). Reads the VAPID public key on
 * the server; renders nothing when push is not configured on this deployment.
 */
export function PushOptIn() {
  const key = pushPublicKey();
  if (!key) return null;
  return <PushOptInClient vapidPublicKey={key} />;
}
