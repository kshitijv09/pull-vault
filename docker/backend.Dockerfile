FROM node:20-alpine AS deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app/backend
COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend ./
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production
COPY --from=build /app/backend/package*.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
EXPOSE 10000
CMD ["sh", "-c", "node dist/workers/packPurchaseQueueConsumer.js & node dist/server.js"]
