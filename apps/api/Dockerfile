FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm install --workspace=@contentpilot/api --include-workspace-root

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=@contentpilot/shared
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm run build --workspace=@contentpilot/api

FROM base AS runner
ENV NODE_ENV=production
ENV UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
RUN mkdir -p /app/uploads
EXPOSE 4000
CMD ["node", "dist/index.js"]
