import { redirect } from "next/navigation";

/** The list moved to My Athletes (/parent/athletes); old links and bookmarks land there. */
export default function ParentChildrenPage() {
  redirect("/parent/athletes");
}
