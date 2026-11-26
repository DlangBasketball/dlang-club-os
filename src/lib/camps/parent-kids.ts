import "server-only";
import { createClient } from "@/lib/supabase/server";

/** The signed-in guardian's own children (family links + RLS on athletes), active only. */
export async function guardianKids(profileId: string, orgId: string): Promise<{ id: string; name: string; dob: string | null }[]> {
  const supabase = await createClient();
  const { data: links } = await supabase.from("family_members").select("family_id").eq("profile_id", profileId);
  const familyIds = (links ?? []).map((l) => l.family_id);
  if (!familyIds.length) return [];
  const { data: kids } = await supabase.from("athletes").select("id,first_name,last_name,dob,status")
    .eq("org_id", orgId).in("family_id", familyIds).order("first_name");
  return (kids ?? []).filter((k) => k.status !== "inactive").map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}`, dob: k.dob }));
}
