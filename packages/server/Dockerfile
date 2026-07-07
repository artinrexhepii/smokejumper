FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
# flat node_modules so the runtime stage can copy it and plain node can resolve deps
RUN echo "node-linker=hoisted" >> .npmrc

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @smokejumper/server...
RUN pnpm --filter @smokejumper/server build

FROM base AS proddeps
RUN pnpm install --prod --frozen-lockfile --filter @smokejumper/server...

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=proddeps --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/server/dist ./dist
COPY --from=build --chown=node:node /repo/packages/server/package.json ./package.json
# runMigrations reads these SQL files via new URL('../migrations', import.meta.url);
# from the bundled dist/ that resolves to /app/migrations at runtime
COPY --from=build --chown=node:node /repo/packages/db/migrations ./migrations
# loadRegistryIndex reads this via new URL('../first-party-index.json', import.meta.url);
# from the bundled dist/ that resolves to /app/first-party-index.json at runtime
COPY --from=build --chown=node:node /repo/packages/registry/first-party-index.json ./first-party-index.json
USER node
EXPOSE 3400
CMD ["node", "dist/main.js"]
