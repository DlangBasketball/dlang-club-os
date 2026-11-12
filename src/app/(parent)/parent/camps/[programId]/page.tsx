import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { CampRegister } from "@/components/camps/camp-register";
import { getSessionUser } from "@/lib/auth/get-user";
import { getMemberCamp } from "@/lib/camps/data";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";

export default async function ParentCampPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const me = await getSessionUser();
  if (!me?.orgId) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(programId)) notFound();
  const camp = await getMemberCamp(me.orgId, programId);
  if (!camp) notFound();
  const { t } = await getI18n();
  // The signed-in guardian's own children only (family links + RLS on athletes).
  const supabase = await createClient();
  const { data: links } = await supabase.from("family_members").select("family_id").eq("profile_id", me.id);
  const familyIds = (links ?? []).map((l) => l.family_id);
  const { data: kids } = familyIds.length
    ? await supabase.from("athletes").select("id,first_name,last_name,dob,status").eq("org_id", me.orgId).in("family_id", familyIds).order("first_name")
    : { data: [] as { id: string; first_name: string; last_name: string; dob: string; status: string }[] };
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={camp.program.name} description={t("camps.parent.registerDescription")} />
      {camp.program.description && <p className="whitespace-pre-wrap text-sm text-ink-2">{camp.program.description}</p>}
      <CampRegister mode="parent" camp={camp}
        kids={(kids ?? []).filter((k) => k.status !== "inactive").map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}`, dob: k.dob }))} />
    </div>
  );
}
