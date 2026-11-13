# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Club OS — production image (Next.js standalone output).
# Alternative to Vercel for self-hosting (e.g. Infomaniak / Exoscale in CH,
# Hetzner / Scaleway in the EU, AWS/Fly in the US). One image, configured per
# region purely through environment variables.
#
#   docker build \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://app.example.com \
#     --build-arg APP_VERSION=$(git describe --tags --always) \
#     --build-arg GIT_SHA=$(git rev-parse HEAD) \
#     -t club-os:latest .
#   docker run --env-file .env.production -p 3000:3000 club-os:latest
#
# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time, so
# build one image per region/environment. Server secrets (service role, Stripe,
# Resend…) are provided at RUN time only — never as build args.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=20.18.1

# ---- deps ------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build -----------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && mkdir -p public

# ---- runtime ---------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ARG APP_VERSION=dev
ARG GIT_SHA=
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA}

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# public/ is optional in this repo (created empty in the build stage if absent).
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health?probe=live" >/dev/null || exit 1

CMD ["node", "server.js"]
