/**
 * Isomorphic tenant helpers (safe in server + client components).
 * Server-only:  import { getTenant } from "@/lib/tenant/server";
 * Client hooks: import { useTenant, useTerm } from "@/lib/tenant/context";
 */
export * from "./types";
export * from "./defaults";
export * from "./terms";
export * from "./theme";
export { normalizeBranding, brandingToJson, rowToTenant } from "./normalize";
export { parseTenantHost, normalizeHost, isValidSlug } from "./host";
