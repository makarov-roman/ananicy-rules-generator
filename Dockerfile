FROM node:25-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
COPY generate_conf.yaml ./

RUN mkdir -p data

ENTRYPOINT ["npx", "tsx", "src/index.ts"]
