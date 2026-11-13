import { redirect } from "next/navigation";

/** Venues are managed on the unified locations page. */
export default function VenuesPage() {
  redirect("/admin/locations");
}
