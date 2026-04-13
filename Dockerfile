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

RUN addgroup --system app && adduser --system --ingroup app app
RUN chown -R app:app /data
USER app

CMD ["node", "dist/index.js"]
