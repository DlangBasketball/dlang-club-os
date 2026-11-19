"use client";

import * as React from "react";
import { fallbackTenant } from "./defaults";
import { makeTerm, type TermFn } from "./terms";
import type { Tenant } from "./types";

/**
 * Client-side tenant context. The root layout resolves the tenant on the
 * server and passes the public-safe object down:
 *
 *   <TenantProvider tenant={tenant}>{children}</TenantProvider>
 *
 * Then in any client component:
 *   const tenant = useTenant();          // name, branding, locale, currency…
 *   const t = useTerm();  t("athlete", { plural: true })  // "Players"
 */

const TenantContext = React.createContext<Tenant | null>(null);

export function TenantProvider({ tenant, children }: { tenant: Tenant; children: React.ReactNode }) {
  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>;
}

export function useTenant(): Tenant {
  return React.useContext(TenantContext) ?? fallbackTenant();
}

export function useTerm(): TermFn {
  const tenant = useTenant();
  return React.useMemo(() => makeTerm(tenant.terminology), [tenant.terminology]);
}
