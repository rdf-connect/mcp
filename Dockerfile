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
    RDFC_MCP_CACHE_DIR=/data
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]

# MCP talks JSON-RPC over stdio - there is no port to expose or healthcheck to poll.
# Run with `docker run -i` (no -t) so a client can attach to stdin/stdout as the transport.
ENTRYPOINT ["node", "dist/index.js"]
