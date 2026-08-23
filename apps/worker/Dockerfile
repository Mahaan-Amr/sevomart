# syntax=docker/dockerfile:1.7
FROM node:22.23.2-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@11.19.0
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/outbox/package.json packages/outbox/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile

FROM dependencies AS build
COPY apps/worker/src apps/worker/src
COPY apps/worker/tsconfig*.json apps/worker/
COPY packages/config/src packages/config/src
COPY packages/config/tsconfig*.json packages/config/
COPY packages/observability/src packages/observability/src
COPY packages/observability/tsconfig*.json packages/observability/
COPY packages/contracts/src packages/contracts/src
COPY packages/contracts/tsconfig*.json packages/contracts/
COPY packages/outbox/src packages/outbox/src
COPY packages/outbox/tsconfig*.json packages/outbox/
RUN pnpm --filter @sevo/worker... build \
  && pnpm --filter @sevo/worker deploy --prod --legacy /runtime \
  && pnpm --filter @sevo/config deploy --prod --legacy /config-runtime \
  && pnpm --filter @sevo/observability deploy --prod --legacy /observability-runtime \
  && pnpm --filter @sevo/contracts deploy --prod --legacy /contracts-runtime \
  && pnpm --filter @sevo/outbox deploy --prod --legacy /outbox-runtime \
  && cp -an /config-runtime/node_modules/. /runtime/node_modules/ \
  && cp -an /observability-runtime/node_modules/. /runtime/node_modules/ \
  && cp -an /contracts-runtime/node_modules/. /runtime/node_modules/ \
  && cp -an /outbox-runtime/node_modules/. /runtime/node_modules/ \
  && cp -R apps/worker/dist /runtime/dist \
  && rm -rf /runtime/node_modules/@sevo \
  && mkdir -p /runtime/node_modules/@sevo/config /runtime/node_modules/@sevo/contracts /runtime/node_modules/@sevo/observability /runtime/node_modules/@sevo/outbox \
  && cp packages/config/package.json /runtime/node_modules/@sevo/config/package.json \
  && cp -R packages/config/dist /runtime/node_modules/@sevo/config/dist \
  && cp packages/observability/package.json /runtime/node_modules/@sevo/observability/package.json \
  && cp -R packages/observability/dist /runtime/node_modules/@sevo/observability/dist \
  && cp packages/contracts/package.json /runtime/node_modules/@sevo/contracts/package.json \
  && cp -R packages/contracts/dist /runtime/node_modules/@sevo/contracts/dist \
  && cp packages/outbox/package.json /runtime/node_modules/@sevo/outbox/package.json \
  && cp -R packages/outbox/dist /runtime/node_modules/@sevo/outbox/dist

FROM node:22.23.2-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /runtime ./
USER node
EXPOSE 3002
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
