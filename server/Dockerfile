FROM node:20-alpine AS builder
WORKDIR /app

# Copy shared types (needed for TypeScript compilation)
COPY shared/ ./shared/

# Copy server and install deps
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci

# Copy server source
COPY server/ .

# Generate Prisma client and build
RUN npx prisma generate --schema=src/prisma/schema.prisma
RUN npm run build

# --- Production image ---
FROM node:20-alpine
WORKDIR /app/server

COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./
COPY --from=builder /app/server/src/prisma ./src/prisma

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy --schema=src/prisma/schema.prisma && npm start"]