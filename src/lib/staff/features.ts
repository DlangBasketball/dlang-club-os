/**
 * Optional coach-app links that depend on modules shipped separately.
 *
 * The evaluations module (athlete development track) adds /coach/evaluations.
 * Until that route exists in this build the dashboard hides the "Evaluations
 * history" tile; set this to the route once the module is merged.
 */
export const COACH_EVALUATIONS_HREF: string | null = "/coach/development";
