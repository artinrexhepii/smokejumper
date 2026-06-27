FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN echo "node-linker=hoisted" >> .npmrc

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @smokejumper/demo...
RUN pnpm --filter @smokejumper/demo build

FROM base AS proddeps
RUN pnpm install --prod --frozen-lockfile --filter @smokejumper/demo...

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=proddeps --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/demo/dist ./dist
COPY --from=build --chown=node:node /repo/demo/package.json ./package.json
USER node
CMD ["node", "dist/serve-shop-api.js"]
