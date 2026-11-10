# Image tunggal untuk proses api, tracker, worker, dan migrate (perintah dipilih di compose.yaml).
# Build context = root repository:  docker build -f apps/api/Dockerfile .

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/api --include-workspace-root=false --no-audit --no-fund
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/api --include-workspace-root=false --omit=dev --no-audit --no-fund \
  && mkdir -p apps/api/node_modules
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api
USER node
CMD ["node", "dist/main.js"]
