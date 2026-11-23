import { redirect } from "next/navigation";

/** /player is the role home (ROLE_HOME.player); the portal starts on /player/home. */
export default function PlayerIndex() {
  redirect("/player/home");
}
