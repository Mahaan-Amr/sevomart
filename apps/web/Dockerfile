# syntax=docker/dockerfile:1.7
FROM node:22.23.2-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@11.19.0
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile

FROM dependencies AS build
COPY apps/web/src apps/web/src
COPY apps/web/public apps/web/public
COPY apps/web/next.config.ts apps/web/next-env.d.ts apps/web/tsconfig.json apps/web/
COPY packages/contracts/src packages/contracts/src
COPY packages/contracts/tsconfig*.json packages/contracts/
RUN pnpm --filter @sevo/web... build \
  && swc_source="$(find node_modules/.pnpm -path '*/node_modules/@swc/helpers' -type d | head -n 1)" \
  && swc_link="$(find apps/web/.next/standalone/node_modules/.pnpm -path '*/node_modules/@swc/helpers' -type l | head -n 1)" \
  && swc_target="$(readlink -f "$swc_link")" \
  && cp -a "$swc_source/." "$swc_target/"

FROM node:22.23.2-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /workspace/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
