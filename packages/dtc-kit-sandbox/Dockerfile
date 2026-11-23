# SPDX-License-Identifier: Apache-2.0
# Sandbox image. Build context is the issuer-readiness-kit repo root:  docker build -f packages/dtc-kit-sandbox/Dockerfile .
FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
ENV PORT=8080 DTC_PROFILE=dtc-stellar
EXPOSE 8080
USER node
CMD ["node", "packages/dtc-kit-sandbox/src/server.ts"]
