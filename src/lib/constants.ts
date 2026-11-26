import { PLATFORM_NAME } from "@/lib/brand";
/** Platform (product) name. Club names come from the tenant: getTenant() / useTenant(). */
export const APP_NAME = PLATFORM_NAME;

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
