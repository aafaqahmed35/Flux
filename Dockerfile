# Multi-Stage Dockerfile for Flux Backend Service

# Stage 1: Dependencies & Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./

RUN npm ci

COPY src ./src

RUN npm run build

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

# Use non-root user for enhanced security
USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]
