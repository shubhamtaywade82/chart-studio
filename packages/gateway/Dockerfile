FROM node:22-alpine AS build
WORKDIR /app

# Copy workspace metadata + internal deps
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/adapter-core ./packages/adapter-core
COPY packages/ai-engine ./packages/ai-engine
COPY packages/gateway ./packages/gateway

RUN npm install --workspaces --include-workspace-root --no-audit --no-fund
RUN npm run -w @chart-studio/adapter-core build
RUN npm run -w @chart-studio/ai-engine build
RUN npm run -w @chart-studio/gateway build

FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/adapter-core ./packages/adapter-core
COPY --from=build /app/packages/ai-engine ./packages/ai-engine
COPY --from=build /app/packages/gateway ./packages/gateway
USER node
EXPOSE 4100
CMD ["node", "packages/gateway/dist/index.js"]
