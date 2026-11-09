FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY vite.config.js ./
COPY src ./src
COPY web ./web
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production DISABLE_AUTOUPDATER=1
RUN npm install -g @anthropic-ai/claude-code@2.1.319 && npm cache clean --force
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/web/dist ./web/dist
COPY package.json ./
COPY src ./src
COPY items ./items
CMD ["node", "src/cli.js", "daemon"]
