"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";

export type ProgramActionResult = { ok: true } | { ok: false; error: string };

const schema = z
  .object({
    name: z.string().trim().min(2, "Enter a name").max(120),
    kind: z.enum(["camp", "recurring_team", "clinic", "tournament"]),
    price: z.coerce.number().min(0, "Price can't be negative").max(1_000_000),
    capacity: z.union([z.literal(""), z.coerce.number().int().min(1).max(10_000)]).optional(),
    startsOn: z.string().optional().default(""),
    endsOn: z.string().optional().default(""),
    location: z.string().trim().max(200).optional().default(""),
    description: z.string().trim().max(4000).optional().default(""),
    isPublic: z.boolean().optional().default(false),
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, { message: "End date must be on or after the start date", path: ["endsOn"] });

export type ProgramInput = z.input<typeof schema>;

/** Public registration URLs look programmes up by slug, so make it unique platform-wide. */
function slugFor(name: string): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "program";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

export async function createProgram(input: ProgramInput): Promise<ProgramActionResult> {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return { ok: false, error: "Not permitted" };
  if (!(await tenantMatchesOrg(me.orgId))) return { ok: false, error: "Not permitted" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid programme" };
  const v = parsed.data;

  const supabase = await createClient();
  // org_id comes from the session, and RLS (programs_admin_write) re-checks it.
  const { error } = await supabase.from("programs").insert({
    org_id: me.orgId,
    slug: slugFor(v.name),
    name: v.name,
    kind: v.kind,
    price_chf: v.price,
    capacity: v.capacity === "" || v.capacity === undefined ? null : v.capacity,
    starts_on: v.startsOn || null,
    ends_on: v.endsOn || null,
    location: v.location || null,
    description: v.description || null,
    is_public: v.isPublic,
    is_active: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/programs");
  redirect("/admin/programs");
}
