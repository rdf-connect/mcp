# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    RDFC_MCP_CACHE_DIR=/data \
    MCP_HTTP_PORT=3001
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_HTTP_PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/index.js"]
