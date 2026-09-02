# syntax=docker/dockerfile:1.7
FROM node:22.23.2-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@11.19.0
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json packages/database/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/outbox/package.json packages/outbox/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile \
  && pnpm --filter @sevo/database deploy --prod --legacy /runtime

FROM node:22.23.2-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl tini \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=dependencies --chown=node:node /runtime ./
COPY --chown=node:node packages/database/prisma ./prisma
COPY --chown=node:node packages/database/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node scripts/demo ./scripts/demo
COPY --chown=node:node ops/demo ./ops/demo
COPY --chown=node:node apps/api/src/modules/content/demo-seed.composition.mjs ./apps/api/src/modules/content/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/conversations/demo-seed.composition.mjs ./apps/api/src/modules/conversations/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/discovery/demo-seed.composition.mjs ./apps/api/src/modules/discovery/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/fulfillment/demo-seed.composition.mjs ./apps/api/src/modules/fulfillment/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/identity-access/demo-seed.composition.mjs ./apps/api/src/modules/identity-access/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/inventory/demo-seed.composition.mjs ./apps/api/src/modules/inventory/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/media/demo-seed.composition.mjs ./apps/api/src/modules/media/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/orders/demo-seed.composition.mjs ./apps/api/src/modules/orders/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/payments/demo-seed.composition.mjs ./apps/api/src/modules/payments/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/problem-follow-up/demo-seed.composition.mjs ./apps/api/src/modules/problem-follow-up/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/product/demo-seed.composition.mjs ./apps/api/src/modules/product/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/reporting-analytics/demo-seed.composition.mjs ./apps/api/src/modules/reporting-analytics/demo-seed.composition.mjs
COPY --chown=node:node apps/api/src/modules/store/demo-seed.composition.mjs ./apps/api/src/modules/store/demo-seed.composition.mjs
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]
