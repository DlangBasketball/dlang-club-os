import { redirect } from "next/navigation";
import { getSessionUser, postLoginDestination } from "@/lib/auth/get-user";

export default async function RootPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect(postLoginDestination(user));
}
