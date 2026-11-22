/**
 * Reads every row of a query filtered by a (possibly long) id list.
 *
 * PostgREST caps one response at ~1000 rows and a long `.in()` list makes the
 * request URL too long, so aggregates built from one plain read (attendance
 * counts, RSVP tallies, paid amounts) silently came out low for big clubs.
 * This splits the ids into chunks and pages through each chunk. The query
 * built by `run` must be ordered on a unique key so pages do not overlap.
 */
type Page<R> = PromiseLike<{ data: R[] | null; error: { message: string } | null }>;

export const PAGE_ROWS = 1000;

export async function pagedIn<R>(
  ids: readonly string[],
  run: (chunk: string[], from: number, to: number) => Page<R>,
  chunkSize = 100,
): Promise<{ rows: R[]; error: string | null }> {
  const rows: R[] = [];
  const uniq = Array.from(new Set(ids));
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    for (let from = 0; from < 1_000_000; from += PAGE_ROWS) {
      const { data, error } = await run(chunk, from, from + PAGE_ROWS - 1);
      if (error) return { rows, error: error.message };
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_ROWS) break;
    }
  }
  return { rows, error: null };
}
