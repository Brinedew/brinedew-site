# Brinedew (Quartz fork) production container.
#
# This Dockerfile + .github/workflows/docker-build-push.yaml are upstream
# Quartz carryover. The build-push workflow is gated on
# `github.repository == 'jackyzha0/quartz'` (see docker-build-push.yaml),
# so it never runs in the brinedew fork. Keep the file present and
# buildable so a contributor can still `docker build` locally.
#
# Brainfart fix history:
#   - The previous version ran `npm ci` for a project that ships pnpm
#     (package.json#packageManager = "pnpm@11.0.9"). That ignored the
#     pnpm lockfile and the .npmrc#minimumReleaseAge=1440 contract.
#   - `apt-get install` was missing --no-install-recommends.
#   - `COPY package-lock.json*` (glob) was a no-op (this repo has no
#     package-lock.json).

FROM node:22-slim AS builder

# --no-install-recommends: skip optional apt packages we do not need.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY quartz/ ./quartz/
COPY quartz.lock.json ./

# Use the same packageManager declared in package.json. corepack pins the
# pnpm version per the lockfile contract; `pnpm install --frozen-lockfile`
# honors .npmrc#minimumReleaseAge=1440.
RUN corepack enable \
 && corepack prepare pnpm@11.0.9 --activate \
 && pnpm install --frozen-lockfile \
 && pnpm exec quartz plugin install --from-config

FROM node:22-slim
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/ /usr/src/app/
COPY . .
CMD ["npx", "quartz", "build", "--serve"]
