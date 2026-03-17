FROM node:25-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/

RUN mkdir -p data

ENTRYPOINT ["npx", "tsx", "src/index.ts"]
