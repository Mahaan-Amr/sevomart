FROM node:22.13.0-bookworm-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.19.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @sevo/web... build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@sevo/web", "start"]
