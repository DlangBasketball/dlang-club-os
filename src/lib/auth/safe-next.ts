/** Only same-site absolute paths: "/x", never "//host", "/\\host" or "@host". */
export function isSafeNextPath(next: string): boolean {
  return /^\/(?![\/\\])[^\s]*$/.test(next) && !next.includes("\\");
}
