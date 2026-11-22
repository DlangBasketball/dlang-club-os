/**
 * Unwraps a Supabase list response for a page's main list. A failed query
 * throws, so the route's error boundary (error.tsx) shows an error state with
 * a retry instead of the page silently rendering "nothing here yet".
 */
export function must<T>(res: { data: T[] | null; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? [];
}
