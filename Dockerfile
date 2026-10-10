FROM node:24-bookworm-slim
WORKDIR /app
RUN useradd --system --uid 1001 --create-home radar
COPY package.json package-lock.json ./
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm ci --registry=$NPM_REGISTRY
COPY . .
RUN npm run build && mkdir -p /data && chown radar:radar /data /app
USER radar
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=8791
ENV DATABASE_PATH=/data/radar.sqlite
EXPOSE 8791
CMD ["node", "server/index.mjs"]
