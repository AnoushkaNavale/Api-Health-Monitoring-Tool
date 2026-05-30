# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json turbo.json tsconfig.base.json ./

COPY packages/types/package.json      ./packages/types/
COPY packages/db/package.json         ./packages/db/
COPY packages/queue/package.json      ./packages/queue/
COPY apps/scheduler/package.json      ./apps/scheduler/

RUN npm install --workspaces --include-workspace-root

COPY packages/types/src               ./packages/types/src
COPY packages/db/src                  ./packages/db/src
COPY packages/queue/src               ./packages/queue/src
COPY packages/types/tsconfig.json     ./packages/types/
COPY packages/db/tsconfig.json        ./packages/db/
COPY packages/queue/tsconfig.json     ./packages/queue/
COPY apps/scheduler/src               ./apps/scheduler/src
COPY apps/scheduler/tsconfig.json     ./apps/scheduler/

RUN npm run build --workspace=packages/types \
 && npm run build --workspace=packages/db \
 && npm run build --workspace=packages/queue \
 && npm run build --workspace=apps/scheduler

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json turbo.json ./
COPY packages/types/package.json      ./packages/types/
COPY packages/db/package.json         ./packages/db/
COPY packages/queue/package.json      ./packages/queue/
COPY apps/scheduler/package.json      ./apps/scheduler/

RUN npm install --workspaces --include-workspace-root --omit=dev

COPY --from=builder /app/packages/types/dist      ./packages/types/dist
COPY --from=builder /app/packages/db/dist         ./packages/db/dist
COPY --from=builder /app/packages/queue/dist      ./packages/queue/dist
COPY --from=builder /app/apps/scheduler/dist      ./apps/scheduler/dist

# schema.sql is needed by runMigrations at boot
COPY packages/db/src/schema.sql ./packages/db/dist/schema.sql
COPY packages/db/src/triggers.sql ./packages/db/dist/triggers.sql

USER node

CMD ["node", "apps/scheduler/dist/index.js"]
