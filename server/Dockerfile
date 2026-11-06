# The ASOIU career API (MySQL backend). Build from the repository root, so the
# Edge Function sources in supabase/functions are included:
#   docker build -f server/Dockerfile -t asoiu-career-api .
FROM node:24-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/ server/
COPY supabase/functions/ supabase/functions/
RUN mkdir -p /data/storage && chown -R node:node /data/storage
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8000 STORAGE_DIR=/data/storage FUNCTIONS_DIR=/app/supabase/functions
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8000/auth/v1/health >/dev/null || exit 1
CMD ["node", "server/src/index.ts"]
