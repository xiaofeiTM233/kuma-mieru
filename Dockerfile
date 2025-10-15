FROM oven/bun:1.2-alpine AS builder
WORKDIR /app

ARG NODE_ENV=production
ARG NEXT_TELEMETRY_DISABLED=1
ARG UPTIME_KUMA_BASE_URL=https://whimsical-sopapillas-78abba.netlify.app
ARG PAGE_ID=demo
ARG FEATURE_EDIT_THIS_PAGE=false
ARG FEATURE_SHOW_STAR_BUTTON=true
ARG FEATURE_TITLE="Uptime Kuma"
ARG FEATURE_DESCRIPTION="A beautiful and modern uptime monitoring dashboard"
ARG FEATURE_ICON=
ARG IS_DOCKER=true

ENV NODE_ENV=${NODE_ENV} \
  NEXT_TELEMETRY_DISABLED=${NEXT_TELEMETRY_DISABLED} \
  UPTIME_KUMA_BASE_URL=${UPTIME_KUMA_BASE_URL} \
  PAGE_ID=${PAGE_ID} \
  FEATURE_EDIT_THIS_PAGE=${FEATURE_EDIT_THIS_PAGE} \
  FEATURE_SHOW_STAR_BUTTON=${FEATURE_SHOW_STAR_BUTTON} \
  FEATURE_TITLE=${FEATURE_TITLE} \
  FEATURE_DESCRIPTION=${FEATURE_DESCRIPTION} \
  FEATURE_ICON=${FEATURE_ICON}

RUN apk add --no-cache curl

RUN if [ "$UPTIME_KUMA_BASE_URL" = "https://whimsical-sopapillas-78abba.netlify.app" ]; then \
  echo "Warning: Using default UPTIME_KUMA_BASE_URL. Consider setting your own URL."; \
  fi

RUN if [ "$PAGE_ID" = "demo" ]; then \
  echo "Warning: Using default PAGE_ID 'demo'. Consider setting your own PAGE_ID."; \
  fi

COPY package.json bun.lock ./
COPY scripts ./scripts
COPY utils ./utils

RUN set -e && \
  echo "Installing dependencies..." && \
  bun install --frozen-lockfile || { echo "Failed to install dependencies"; exit 1; }

COPY . .

RUN set -e && \
  echo "Starting build process..." && \
  bun run build || { echo "Build failed"; exit 1; }

# Runtime image
FROM oven/bun:1.2-alpine
WORKDIR /app

ARG PORT=3000
ARG HOSTNAME="0.0.0.0"
ARG NODE_ENV=production
ARG NEXT_TELEMETRY_DISABLED=1
ARG UPTIME_KUMA_BASE_URL=https://whimsical-sopapillas-78abba.netlify.app
ARG PAGE_ID=demo
ARG FEATURE_EDIT_THIS_PAGE=false
ARG FEATURE_SHOW_STAR_BUTTON=true
ARG FEATURE_TITLE="Uptime Kuma"
ARG FEATURE_DESCRIPTION="A beautiful and modern uptime monitoring dashboard"
ARG FEATURE_ICON=
ARG IS_DOCKER=true

ENV PORT=${PORT} \
  HOSTNAME=${HOSTNAME} \
  NODE_ENV=${NODE_ENV} \
  NEXT_TELEMETRY_DISABLED=${NEXT_TELEMETRY_DISABLED} \
  UPTIME_KUMA_BASE_URL=${UPTIME_KUMA_BASE_URL} \
  PAGE_ID=${PAGE_ID} \
  FEATURE_EDIT_THIS_PAGE=${FEATURE_EDIT_THIS_PAGE} \
  FEATURE_SHOW_STAR_BUTTON=${FEATURE_SHOW_STAR_BUTTON} \
  FEATURE_TITLE=${FEATURE_TITLE} \
  FEATURE_DESCRIPTION=${FEATURE_DESCRIPTION} \
  FEATURE_ICON=${FEATURE_ICON}

RUN apk add --no-cache curl

RUN if [ "$UPTIME_KUMA_BASE_URL" = "https://whimsical-sopapillas-78abba.netlify.app" ]; then \
  echo "Warning: Using default UPTIME_KUMA_BASE_URL. Consider setting your own URL."; \
  fi

RUN if [ "$PAGE_ID" = "demo" ]; then \
  echo "Warning: Using default PAGE_ID 'demo'. Consider setting your own PAGE_ID."; \
  fi

COPY --from=builder /app/.next/standalone/ ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./
COPY --from=builder /app/node_modules ./node_modules
# Generated config files
COPY --from=builder /app/config ./config
# Scripts & Utilities
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/.next/static ./.next/static

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:${PORT}/api/health || exit 1

CMD ["bun", "run", "start:docker"]
