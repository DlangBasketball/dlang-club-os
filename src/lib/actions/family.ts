"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function gate(adminOnly = false) {
  const me = await getSessionUser();
  const allowed =
    !!me &&
    (adminOnly
      ? me.roles.includes("admin")
      : me.roles.includes("admin") || me.roles.includes("finance"));
  return { me: allowed ? me : null };
}

export type FamilyInput = { name: string; address?: string; phone?: string };

export async function createFamily(input: FamilyInput): Promise<ActionResult> {
  const { me } = await gate();
  if (!me) return { ok: false, error: "You don't have permission to do that." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("families")
    .insert({ org_id: me.orgId, name: input.name, address: input.address ?? null, phone: input.phone ?? null })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/families");
  redirect(`/admin/families/${data.id}`);
}

export async function updateFamily(id: string, input: FamilyInput): Promise<ActionResult> {
  const { me } = await gate();
  if (!me) return { ok: false, error: "You don't have permission to do that." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("families")
    .update({ name: input.name, address: input.address ?? null, phone: input.phone ?? null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/families/${id}`);
  redirect(`/admin/families/${id}`);
}

export async function deleteFamily(id: string): Promise<ActionResult> {
  const { me } = await gate(true); // admin only
  if (!me) return { ok: false, error: "Only admins can delete families." };
  const supabase = await createClient();
  const { error } = await supabase.from("families").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/families");
  redirect("/admin/families");
}
