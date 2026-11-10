# Dashboard Next.js (output standalone). Build context = root repository:
#   docker build -f apps/dashboard/Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --workspace apps/dashboard --include-workspace-root=false --no-audit --no-fund
COPY apps/dashboard apps/dashboard
RUN npm run build --workspace apps/dashboard

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
