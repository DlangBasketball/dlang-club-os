/**
 * Calls a database function that the generated types do not list yet.
 *
 * The method must stay bound to its client: supabase-js implements rpc() as
 * `this.rest.rpc(...)`, so a detached reference (`const call = db.rpc`)
 * throws "Cannot read properties of undefined (reading 'rest')". That broke
 * the delete / archive dialogs for athletes, families and teams (the impact
 * preview never loaded, so the confirm button stayed disabled).
 */
export type RpcResult<T = unknown> = { data: T | null; error: { message: string; code?: string } | null };

export function callRpc<T = unknown>(db: { rpc: unknown }, fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  const rpc = db.rpc as (f: string, a: Record<string, unknown>) => Promise<RpcResult<T>>;
  return rpc.call(db, fn, args);
}
