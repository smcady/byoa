# Build stage
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

# Production stage
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist dist/

ENV BYOA_DATA_DIR=/data/channels
RUN mkdir -p /data/channels

EXPOSE 3737

# NOTE: Running as root because Railway's volume mounts are root-owned and
# incompatible with a non-root app user. Revisit with an entrypoint script
# that chowns the mount before dropping privileges. See issue #45.

CMD ["node", "dist/index.js"]
