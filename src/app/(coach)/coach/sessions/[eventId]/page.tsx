import { notFound, redirect } from "next/navigation";
import { uuidSchema } from "@/lib/attendance/types";

/** Notification links (/coach/sessions/<eventId>) open the session details. */
export default async function CoachSessionRedirect({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!uuidSchema.safeParse(eventId).success) notFound();
  redirect(`/coach/trainings/${eventId}`);
}
