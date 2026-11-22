import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/supabase/rpc";

describe("callRpc keeps rpc bound to its client", () => {
  const seen: string[] = [];
  const db = createClient("http://localhost:54321", "anon-key-for-tests", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    },
  });

  it("a detached db.rpc throws (the bug in the delete / archive dialogs)", async () => {
    const detached = db.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<unknown>;
    await expect(async () => detached("preview_person_delete", {})).rejects.toThrow();
  });

  it("callRpc calls the function through the client", async () => {
    const res = await callRpc<{ ok: boolean }>(db, "preview_person_delete", { p_kind: "family" });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ ok: true });
    expect(seen.at(-1)).toContain("/rest/v1/rpc/preview_person_delete");
  });
});
