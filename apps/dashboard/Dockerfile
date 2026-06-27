FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @smokejumper/dashboard...
# NEXT_PUBLIC_* is inlined at build time; rebuild with --build-arg for non-localhost deploys
ARG NEXT_PUBLIC_API_URL=http://localhost:3400
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @smokejumper/dashboard build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build --chown=node:node /repo/apps/dashboard/public ./apps/dashboard/public
USER node
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
