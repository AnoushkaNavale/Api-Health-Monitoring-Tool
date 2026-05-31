FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json turbo.json ./
COPY apps/web/package.json ./apps/web/

RUN npm install --workspaces --include-workspace-root

COPY apps/web ./apps/web

RUN npm run build --workspace=apps/web

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
