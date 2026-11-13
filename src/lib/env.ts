import "server-only";

/**
 * Centralised environment-variable access with validation.
 * Secrets (service role key, Stripe/Resend keys) are read ONLY here, ONLY on
 * the server. NEXT_PUBLIC_* values are the only ones that may reach the client.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}
function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

export const env = {
  // Public (safe to expose to the browser)
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  siteUrl: () => optional("NEXT_PUBLIC_SITE_URL") ?? "http://localhost:3000",
  // Server-only secrets
  serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  resendApiKey: () => optional("RESEND_API_KEY"),
  stripeSecretKey: () => optional("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => optional("STRIPE_WEBHOOK_SECRET"),
  anthropicApiKey: () => optional("ANTHROPIC_API_KEY"),
  // Model identifier is configuration, never hard-coded (set ANTHROPIC_MODEL).
  anthropicModel: () => optional("ANTHROPIC_MODEL"),
};

/** Fail fast at boot if critical secrets are absent or obviously misplaced. */
export function assertServerEnv(): void {
  required("NEXT_PUBLIC_SUPABASE_URL");
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  required("SUPABASE_SERVICE_ROLE_KEY");
  // Guard against the classic footgun: a secret leaking through a public var.
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("NEXT_PUBLIC_") && typeof v === "string" && /service_role|sk_live|sk_test|re_[A-Za-z0-9]/.test(v)) {
      throw new Error(`Public env var ${k} appears to contain a secret — never expose secrets via NEXT_PUBLIC_*`);
    }
  }
}
