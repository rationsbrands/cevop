FROM node:20-alpine AS builder
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

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

# Install OpenSSL for Prisma at runtime
RUN apk add --no-cache openssl

COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./
COPY --from=builder /app/server/src/prisma ./src/prisma

# Create non-root user and give ownership
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app/server

USER appuser

EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy --schema=src/prisma/schema.prisma && node dist/server/src/index.js"]