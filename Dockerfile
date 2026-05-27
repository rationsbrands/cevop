FROM node:20-alpine AS builder
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Copy root workspace files
COPY package.json package-lock.json ./

# Copy shared types and server package
COPY shared/ ./shared/
COPY server/package.json ./server/
COPY server/src/prisma ./server/src/prisma

# Install all dependencies using npm ci from root
RUN npm ci

# Copy server source
COPY server/ ./server/

# Generate Prisma client and build from the server workspace
WORKDIR /app/server
RUN npx prisma generate --schema=src/prisma/schema.prisma
RUN npm run build

# --- Production image ---
FROM node:20-alpine
WORKDIR /app/server

# Install OpenSSL for Prisma at runtime
RUN apk add --no-cache openssl

# Copy root node_modules and server build artifacts
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/package.json ./
COPY --from=builder /app/server/src/prisma ./src/prisma

# Create non-root user and give ownership
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 4000
# Command to run the application
CMD ["sh", "-c", "npx prisma migrate deploy --schema=src/prisma/schema.prisma && npm start"]
