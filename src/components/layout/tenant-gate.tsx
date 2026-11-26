import type { Tenant } from "@/lib/tenant/types";
import { PLATFORM_NAME } from "@/lib/tenant/defaults";

/**
 * Blocks rendering for hosts that name no known tenant, and for suspended
 * tenants. Everything else renders normally.
 */
export function TenantGate({ tenant, children }: { tenant: Tenant; children: React.ReactNode }) {
  if (tenant.source === "unknown") {
    return (
      <GateScreen
        title="Club not found"
        message={`There is no ${PLATFORM_NAME} workspace at this address. Check the link you were given, or contact your club.`}
      />
    );
  }
  if (tenant.status === "suspended") {
    return (
      <GateScreen
        title={`${tenant.name} is unavailable`}
        message="This workspace is temporarily suspended. Please contact the club office."
      />
    );
  }
  return <>{children}</>;
}

function GateScreen({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="max-w-md rounded-lg border border-line bg-surface p-8 text-center shadow-md">
        <h1 className="font-display text-2xl text-ink">{title}</h1>
        <p className="mt-3 text-sm text-ink-2">{message}</p>
      </div>
    </main>
  );
}
