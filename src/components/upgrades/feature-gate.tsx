import { getSessionUser } from "@/lib/auth/get-user";
import { isEnabled } from "@/lib/upgrades/resolve";
import { getOrgFeatureContext } from "@/lib/upgrades/server";
import { UpsellScreen, type UpsellAudience } from "./upsell-screen";

/**
 * Server-side page gate. Wrap a route group's children (layout.tsx) with it:
 *
 *   export default function Layout({ children }) {
 *     return <FeatureGate feature="accounting">{children}</FeatureGate>;
 *   }
 *
 * When the club does not have the feature (any of them, for a list) the page
 * loaders never run: the upsell screen renders instead. Data stays untouched
 * (downgrades never delete), it simply is not shown until re-enabled.
 * Route handlers (route.ts) are not wrapped by layouts: gate them with
 * requireFeature / hasFeature from @/lib/upgrades/server.
 */
export async function FeatureGate({
  feature,
  area = "admin",
  children,
}: {
  feature: string | string[];
  /** Which app renders it: in coach / parent apps only admins see prices. */
  area?: "admin" | "coach" | "parent" | "public";
  children: React.ReactNode;
}) {
  const keys = Array.isArray(feature) ? feature : [feature];
  const me = await getSessionUser();
  if (!me?.orgId) return <>{children}</>; // the auth layer handles signed-out users
  const ctx = await getOrgFeatureContext(me.orgId);
  if (keys.some((k) => isEnabled(ctx.access, k))) return <>{children}</>;
  let audience: UpsellAudience = "member";
  if (me.roles.includes("admin")) audience = "admin";
  else if (area === "admin" && me.roles.includes("finance")) audience = "finance";
  return <UpsellScreen features={keys} ctx={ctx} audience={audience} />;
}

/** Layout factory: `export default featureLayout("accounting")`. */
export function featureLayout(feature: string | string[], area: "admin" | "coach" | "parent" = "admin") {
  return function FeatureLayout({ children }: { children: React.ReactNode }) {
    return (
      <FeatureGate feature={feature} area={area}>
        {children}
      </FeatureGate>
    );
  };
}
