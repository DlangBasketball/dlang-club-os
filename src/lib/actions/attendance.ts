"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import type { Json } from "@/types/database";

export type AttendanceMarkInput = {
  athlete_id: string;
  status: "present" | "late" | "absent" | "excused";
  notes?: string;
  injury_flag?: boolean;
};

export type SaveResult =
  | { ok: true; summary: { present: number; late: number; absent: number; excused: number; injuries: number; total: number; submitted: boolean } }
  | { ok: false; error: string };

export async function saveAttendance(
  attendanceSessionId: string,
  marks: AttendanceMarkInput[],
  submit: boolean,
): Promise<SaveResult> {
  const me = await getSessionUser();
  if (!me || !(me.roles.includes("coach") || me.roles.includes("admin"))) {
    return { ok: false, error: "Not permitted" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_attendance", {
    p_session: attendanceSessionId,
    p_marks: marks as unknown as Json,
    p_submit: submit,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/coach");
  revalidatePath("/coach/attendance");
  const summary = (data ?? { present: 0, late: 0, absent: 0, excused: 0, injuries: 0, total: 0, submitted: submit }) as {
    present: number; late: number; absent: number; excused: number; injuries: number; total: number; submitted: boolean;
  };
  return { ok: true, summary };
}
