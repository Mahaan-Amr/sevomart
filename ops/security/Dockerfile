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
RUN pnpm --filter @sevo/contracts build

FROM node:22.23.2-bookworm-slim AS runtime
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --chown=node:node scripts/recover-superadmin.mjs ./scripts/recover-superadmin.mjs
COPY --chown=node:node scripts/authorize-superadmin-totp.mjs ./scripts/authorize-superadmin-totp.mjs
USER node
ENTRYPOINT ["node"]
CMD ["scripts/recover-superadmin.mjs"]
