FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/newpages-adapter/package.json packages/newpages-adapter/package.json
COPY packages/wordpress-client/package.json packages/wordpress-client/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4300
CMD ["node", "apps/api/dist/server.js"]
