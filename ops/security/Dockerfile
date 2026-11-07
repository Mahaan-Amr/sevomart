# syntax=docker/dockerfile:1.7
FROM node:22.23.2-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@11.19.0
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY patches ./patches
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/outbox/package.json packages/outbox/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile
COPY packages/contracts/src packages/contracts/src
COPY packages/contracts/tsconfig*.json packages/contracts/
RUN pnpm --filter @sevo/contracts build \
  && pnpm --filter @sevo/contracts deploy --prod --legacy /contracts-runtime \
  && mkdir -p /runtime/node_modules/@sevo/contracts \
  && cp -a /contracts-runtime/node_modules/. /runtime/node_modules/ \
  && cp packages/contracts/package.json /runtime/node_modules/@sevo/contracts/package.json \
  && cp -R packages/contracts/dist /runtime/node_modules/@sevo/contracts/dist \
  && cp -R node_modules/.pnpm/postgres@3.4.7/node_modules/postgres /runtime/node_modules/postgres

FROM node:22.23.2-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get upgrade --yes --no-install-recommends \
  && apt-get install --yes --no-install-recommends openssl tini \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build --chown=node:node /runtime/node_modules ./node_modules
COPY --chown=node:node scripts/recover-superadmin.mjs ./scripts/recover-superadmin.mjs
COPY --chown=node:node scripts/recover-superadmin-password.mjs ./scripts/recover-superadmin-password.mjs
COPY --chown=node:node scripts/authorize-superadmin-totp.mjs ./scripts/authorize-superadmin-totp.mjs
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "node"]
CMD ["scripts/recover-superadmin.mjs"]
