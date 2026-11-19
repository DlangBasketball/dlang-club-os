import { getTenant } from "@/lib/tenant/server";
import { PublicSiteHeader } from "@/components/website/public-site-header";

/** Public club shop shell (signed in or not); same header as the club's other public pages and website embeds. */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant();
  return (
    <div className="grain min-h-dvh bg-bg text-text">
      <PublicSiteHeader tenant={tenant} maxWidth="max-w-6xl" />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
