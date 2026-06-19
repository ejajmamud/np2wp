FROM mcr.microsoft.com/playwright:v1.61.0-noble
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/newpages-adapter/package.json packages/newpages-adapter/package.json
COPY packages/wordpress-client/package.json packages/wordpress-client/package.json
RUN npm ci --include=dev
COPY . .
RUN npm run build
CMD ["node", "apps/worker/dist/worker.js"]
