import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (see Dockerfile).
  // Harmless on Vercel, which ignores it.
  output: "standalone",
  // Pin the tracing root to this project so .next/standalone/server.js lands
  // at the top level even if a parent directory contains another lockfile.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  // Athlete photos (max 2 MB) and cover images (max 5 MB, both after
  // client-side resizing) are posted to server actions; the default 1 MB body
  // limit would reject larger ones.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};
export default nextConfig;
