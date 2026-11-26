import { notFound, redirect } from "next/navigation";

/** /parent/athletes/<id> -> the athlete's page (kept at /parent/children/<id> so existing links and bookmarks work). */
export default async function MyAthleteRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  redirect(`/parent/children/${id}`);
}
