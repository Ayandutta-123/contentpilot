FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN npm install --workspace=@contentpilot/web --include-workspace-root

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_NAME=ContentPilot
ARG NEXT_PUBLIC_APP_TAGLINE=B2B Content Engine
ARG API_URL=http://api:4000
ARG INTERNAL_API_URL=http://api:4000
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_APP_TAGLINE=$NEXT_PUBLIC_APP_TAGLINE
ENV API_URL=$API_URL
ENV INTERNAL_API_URL=$INTERNAL_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=@contentpilot/shared
RUN npm run build --workspace=@contentpilot/web

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
