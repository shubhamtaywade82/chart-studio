FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/adapter-core ./packages/adapter-core
COPY packages/ai-engine ./packages/ai-engine

RUN npm install --workspaces --include-workspace-root --no-audit --no-fund
RUN npm run -w @chart-studio/adapter-core build
RUN npm run -w @chart-studio/ai-engine build

FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/adapter-core ./packages/adapter-core
COPY --from=build /app/packages/ai-engine ./packages/ai-engine
USER node
CMD ["node", "packages/ai-engine/dist/index.js"]
