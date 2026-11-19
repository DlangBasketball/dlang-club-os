import Link from "next/link";
import { ShoppingBasket } from "lucide-react";
import { Button, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getMemberCamp, listSeasonCamps, type PublicCamp } from "@/lib/camps/data";
import { guardianKids } from "@/lib/camps/parent-kids";
import { getI18n } from "@/lib/i18n/server";
import { SeasonCampList } from "@/components/camps/season-camp-list";
import { BasketAdder } from "@/components/camps/basket/basket-adder";

export default async function ParentCampsPage() {
  const [me, { t }] = await Promise.all([getSessionUser(), getI18n()]);
  const camps = me?.orgId ? await listSeasonCamps(me.orgId, { publicOnly: false }) : [];
  const full = me?.orgId ? (await Promise.all(camps.map((c) => getMemberCamp(me.orgId!, c.id)))).filter((c): c is PublicCamp => !!c) : [];
  const kids = me?.orgId ? await guardianKids(me.id, me.orgId) : [];
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("camps.parent.title")} description={t("camps.parent.seasonsDescription")}
        actions={<Link href="/parent/camps/basket"><Button variant="secondary"><ShoppingBasket className="h-4 w-4" /> {t("camps.basket.title")}</Button></Link>} />
      <SeasonCampList camps={camps} linkTo="parent" />
      {full.length > 0 && me?.orgId && (
        <BasketAdder mode="parent" scope={`parent:${me.orgId}`} camps={full} kids={kids} basketHref="/parent/camps/basket" />
      )}
    </div>
  );
}
