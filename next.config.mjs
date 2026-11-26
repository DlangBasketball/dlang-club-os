import path from "node:path";
import { fileURLToPath } from "node:url";

// Club website images (next/image): club media library, camp / team covers,
// shop images and public coach photos live in Supabase Storage; YouTube
// thumbnails for click-to-load video facades.
const storageHost = (() => {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    return { protocol: u.protocol.replace(":", ""), hostname: u.hostname, ...(u.port ? { port: u.port } : {}) };
  } catch {
    return null;
  }
})();
const imageRemotePatterns = [
  ...(storageHost ? [{ ...storageHost, pathname: "/storage/v1/object/**" }] : []),
  { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/**" },
  { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: imageRemotePatterns, formats: ["image/avif", "image/webp"] },
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
