import { getTenant } from "@/lib/tenant/server";
import { PublicSiteHeader } from "@/components/website/public-site-header";

/** Public camps area (season chooser + basket): localised with the host's club; same header as the club's website embeds. */
export default async function RegisterCampsLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant();
  return (
    <div className="grain min-h-screen bg-bg text-ink">
      <PublicSiteHeader tenant={tenant} maxWidth="max-w-3xl" />
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
