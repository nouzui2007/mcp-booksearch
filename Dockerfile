# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production stage
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/build ./build

EXPOSE 8080
ENV PORT=8080

ENTRYPOINT ["node", "build/index.js"]
