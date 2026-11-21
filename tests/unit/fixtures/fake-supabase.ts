/**
 * Minimal in-memory stand-in for the Supabase query builder (synthetic data
 * only). Supports the calls the upgrades code makes: select / eq / neq / in /
 * is / lte / not / order / limit / maybeSingle / single / insert / update /
 * upsert / delete, awaited directly or via .select(). Every filtered query is
 * recorded so tests can assert it was scoped to an org.
 */
type Row = Record<string, unknown>;

export type FakeDb = {
  tables: Record<string, Row[]>;
  queries: { table: string; op: string; filters: [string, unknown][] }[];
  client: { from: (table: string) => unknown; rpc: (fn: string, args?: unknown) => Promise<{ data: unknown; error: null }> };
};

let seq = 0;

export function fakeSupabase(tables: Record<string, Row[]>, rpc: Record<string, (args: unknown) => unknown> = {}): FakeDb {
  const db: FakeDb = {
    tables,
    queries: [],
    client: {
      from: (table: string) => builder(db, table),
      rpc: async (fn: string, args?: unknown) => ({ data: rpc[fn] ? rpc[fn](args) : null, error: null }),
    },
  };
  return db;
}

function builder(db: FakeDb, table: string) {
  const preds: ((r: Row) => boolean)[] = [];
  const filters: [string, unknown][] = [];
  let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  let payload: Row | Row[] | null = null;
  let single: "maybe" | "one" | null = null;
  let lim: number | null = null;
  const rows = () => (db.tables[table] ??= []);

  const run = () => {
    db.queries.push({ table, op, filters: [...filters] });
    if (op === "insert" || op === "upsert") {
      const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
      const out: Row[] = [];
      for (const p of list) {
        const unique = ["stripe_subscription_item_id"].find((k) => p[k] && rows().some((r) => r[k] === p[k]));
        if (unique && op === "insert") return { data: null, error: { code: "23505", message: `duplicate ${unique}` } };
        if (op === "upsert" && p.org_id && rows().some((r) => r.org_id === p.org_id)) {
          const r = rows().find((x) => x.org_id === p.org_id)!;
          Object.assign(r, p);
          out.push(r);
          continue;
        }
        const r = { id: `fake-${++seq}`, starts_at: new Date().toISOString(), ...p };
        rows().push(r);
        out.push(r);
      }
      return { data: out, error: null };
    }
    let matched = rows().filter((r) => preds.every((f) => f(r)));
    if (op === "update") {
      for (const r of matched) Object.assign(r, payload);
      return { data: matched, error: null };
    }
    if (op === "delete") {
      db.tables[table] = rows().filter((r) => !matched.includes(r));
      return { data: matched, error: null };
    }
    if (lim !== null) matched = matched.slice(0, lim);
    if (single) return { data: matched[0] ?? null, error: null };
    return { data: matched, error: null };
  };

  const b: Record<string, unknown> = {
    select: () => b,
    insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), b),
    upsert: (p: Row | Row[]) => ((op = "upsert"), (payload = p), b),
    update: (p: Row) => ((op = "update"), (payload = p), b),
    delete: () => ((op = "delete"), b),
    eq: (k: string, v: unknown) => (filters.push([k, v]), preds.push((r) => r[k] === v), b),
    neq: (k: string, v: unknown) => (preds.push((r) => r[k] !== v), b),
    in: (k: string, v: unknown[]) => (filters.push([k, v]), preds.push((r) => v.includes(r[k])), b),
    is: (k: string, v: unknown) => (preds.push((r) => (r[k] ?? null) === v), b),
    lte: (k: string, v: string) => (preds.push((r) => String(r[k]) <= v), b),
    lt: (k: string, v: string) => (preds.push((r) => String(r[k]) < v), b),
    not: () => b,
    order: () => b,
    limit: (n: number) => ((lim = n), b),
    maybeSingle: () => ((single = "maybe"), b),
    single: () => ((single = "one"), b),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
