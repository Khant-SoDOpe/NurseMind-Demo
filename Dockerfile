# ---- Build / install dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app

# Install OS deps needed by some native modules
RUN apk add --no-cache dumb-init

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- Runtime ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000

# dumb-init handles PID 1 signals cleanly
RUN apk add --no-cache dumb-init curl

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S app -u 1001 -G nodejs

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:nodejs . .

USER app

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
