FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY tsconfig.json ./
COPY docker ./docker

# Default command — overridden by the seeder service in docker-compose.yml.
# The container is meant to be `docker exec`-ed into; stdio is the wire format,
# so no ports are exposed.
CMD ["pnpm", "exec", "tsx", "src/index.ts", "serve", "--config", "docker/gateway.config.docker.json"]
