import { redirect } from "next/navigation";
import { getSessionUser, postLoginDestination } from "@/lib/auth/get-user";
import { getTenant } from "@/lib/tenant/server";
import { showsHubAtRoot } from "@/lib/pwa/hub";
import { ClubHub } from "@/components/pwa/club-hub";

export default async function RootPage() {
  const user = await getSessionUser();
  if (!user) {
    // On a club's own host, outsiders land on the public club hub (camps,
    // personal training, install app). The platform host keeps sign-in.
    const tenant = await getTenant();
    if (showsHubAtRoot(tenant)) return <ClubHub tenant={tenant} />;
    redirect("/login");
  }
  redirect(postLoginDestination(user));
}
