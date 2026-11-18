#!/usr/bin/env node
/**
 * Generates a VAPID key pair for Web Push (P-256, base64url).
 *   node scripts/generate-vapid-keys.mjs
 * Put the output in the deployment's environment (never commit the private key).
 */
import { createECDH } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
console.log(`VAPID_PUBLIC_KEY=${b64url(ecdh.getPublicKey())}`);
console.log(`VAPID_PRIVATE_KEY=${b64url(ecdh.getPrivateKey())}`);
console.log("VAPID_SUBJECT=mailto:ops@example.com");
