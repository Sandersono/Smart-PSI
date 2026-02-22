FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional

COPY --from=build /app/dist ./dist
COPY server.ts ./server.ts
COPY src ./src
COPY tsconfig.json ./tsconfig.json
COPY metadata.json ./metadata.json

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["npm", "run", "start"]
