import { requireRole } from "@/lib/auth/get-user";
import { SettingsPage } from "@/components/development/pages";

/** Ranking weights, levels / emoji and per-team wellness: admins only. */
export default async function DevelopmentSettingsRoute() {
  await requireRole(["admin"]);
  return <SettingsPage base="/admin/development" />;
}
