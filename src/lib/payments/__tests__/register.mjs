// Test-only resolver: lets Node's built-in type stripping run the payments
// modules, which use extensionless relative imports (bundler style).
//   node --import ./src/lib/payments/__tests__/register.mjs --test src/lib/payments/__tests__/*.test.ts
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) {
      return next(specifier + ".ts", context);
    }
    throw err;
  }
}`),
  import.meta.url,
);
