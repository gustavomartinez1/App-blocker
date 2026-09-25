# Servidor + panel web en una sola imagen.
FROM node:22-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY apps/extension/package.json apps/extension/
RUN npm ci --ignore-scripts
COPY packages/core packages/core
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build -w @guardian/core && npm run build -w @guardian/server && npm run build -w @guardian/web \
  && npm prune --omit=dev --ignore-scripts

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 GUARDIAN_DB=/data/guardian.sqlite GUARDIAN_WEB_DIST=/app/apps/web/dist
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
VOLUME /data
EXPOSE 8787
USER node
WORKDIR /app/apps/server
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
