# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy monorepo root manifests
COPY package.json turbo.json tsconfig.base.json ./

# Copy package manifests for dependency installation
COPY packages/types/package.json   ./packages/types/
COPY packages/db/package.json      ./packages/db/
COPY packages/queue/package.json   ./packages/queue/
COPY apps/api/package.json         ./apps/api/

# Install all deps (including dev — needed for tsc)
RUN npm install --workspaces --include-workspace-root

# Copy source
COPY packages/types/src   ./packages/types/src
COPY packages/db/src      ./packages/db/src
COPY packages/queue/src   ./packages/queue/src
COPY packages/types/tsconfig.json ./packages/types/
COPY packages/db/tsconfig.json    ./packages/db/
COPY packages/queue/tsconfig.json ./packages/queue/
COPY apps/api/src         ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/

# Build shared packages first, then the API app
RUN npm run build --workspace=packages/types \
 && npm run build --workspace=packages/db \
 && npm run build --workspace=packages/queue \
 && npm run build --workspace=apps/api

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Only install production dependencies in the final image
COPY package.json turbo.json ./
COPY packages/types/package.json   ./packages/types/
COPY packages/db/package.json      ./packages/db/
COPY packages/queue/package.json   ./packages/queue/
COPY apps/api/package.json         ./apps/api/

RUN npm install --workspaces --include-workspace-root --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/db/dist    ./packages/db/dist
COPY --from=builder /app/packages/queue/dist ./packages/queue/dist
COPY --from=builder /app/apps/api/dist       ./apps/api/dist

# Copy schema.sql (needed at runtime by migrate.ts)
COPY packages/db/src/schema.sql ./packages/db/dist/schema.sql
COPY packages/db/src/triggers.sql ./packages/db/dist/triggers.sql

EXPOSE 3000

# Run as non-root user
USER node

CMD ["node", "apps/api/dist/app.js"]
