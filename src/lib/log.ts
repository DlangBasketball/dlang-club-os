import "server-only";

/**
 * Structured, redacting logger. Sensitive values (emails, phone numbers, IBANs,
 * API keys, JWTs) are masked before anything is written, so logs never leak PII
 * or credentials — important for an app handling minors and payments.
 */
const PATTERNS: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, "[iban]"],
  [/\b(?:sk|re|pk)_[A-Za-z0-9]{8,}\b/g, "[key]"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[jwt]"],
  [/\+?\d[\d\s().-]{7,}\d/g, "[phone]"],
];
const SENSITIVE_KEYS = /pass|token|secret|key|authorization|iban|ssn|dob|medical|allerg|email|phone/i;

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

/** Log an error with context, redacted. Returns a stable id you can surface. */
export function logError(context: string, err: unknown, extra?: Record<string, unknown>): string {
  const id = crypto.randomUUID().slice(0, 8);
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ level: "error", id, context, message: redact(message), extra: extra ? redact(extra) : undefined, at: new Date().toISOString() }));
  return id;
}

/** Turn any thrown error into a safe, generic message for the client (logs details server-side). */
export function safeError(context: string, err: unknown): string {
  const id = logError(context, err);
  return `Something went wrong (ref ${id}). Please try again or contact support.`;
}
