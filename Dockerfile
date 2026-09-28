# Base Build Stage
FROM node:20-bookworm-slim AS builder

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

# Production Stage
FROM node:20-bookworm-slim

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --only=production

COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 3000

CMD ["sh", "-c", "if [ -f dist/main.js ]; then node dist/main; else node dist/src/main; fi"]
