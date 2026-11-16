# The studio's container: the app's server and worker, run and backed up by the keeper (cloud/keeper.ts).
# The build context is the repository root, and the root .dockerignore lets in only the app's code: never .data/,
# resume/ or any other private file. Wrangler builds this on deploy (studio/wrangler.jsonc). By hand:
#   docker build --platform linux/amd64 -f cloud/Dockerfile -t eggers-studio .
# Cloudflare Containers run linux/amd64 images.

# ---- Downloads, checked against their published SHA-256 sums ---------------------------------------------------
# Cloudflare runs linux/amd64, and wrangler builds for it. The arm64 lines exist only so the image can be built and
# tried natively on an Apple-silicon machine: Bun crashes under Docker's amd64 emulation there (qemu).
FROM debian:trixie-slim AS fetch
ARG TARGETARCH
# Bun 1.4.2. On amd64 the "baseline" build: it needs no AVX2, so it runs whatever CPU features the host's VM exposes.
# Sums from https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/SHASUMS256.txt
ARG BUN_VERSION=1.4.2
ARG BUN_SHA256_AMD64=c678040f14fe0440eb839d37cbd0ce4c051a32da72806ac97de6a6aab6bf728f
ARG BUN_SHA256_ARM64=54328bbc2d9c8e0c9f892c544d66c57a83b84139e34909e5ee81758f1ac8fda7
# The Codex CLI 0.169.0, the static (musl) Linux binary from its GitHub release. Sums from the release assets'
# digests (gh release view rust-v0.169.0 -R openai/codex --json assets).
ARG CODEX_VERSION=0.169.0
ARG CODEX_SHA256_AMD64=9af4d751fce183faedea629437d5252dbf458eeb04130cf4f97be844621ea985
ARG CODEX_SHA256_ARM64=97b97d87eea075c5cb7709c7f6156a451622a7667953ecda40e0276637196f3f
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) bun=bun-linux-x64-baseline; bun_sum=$BUN_SHA256_AMD64; codex=codex-x86_64-unknown-linux-musl; codex_sum=$CODEX_SHA256_AMD64 ;; \
      arm64) bun=bun-linux-aarch64; bun_sum=$BUN_SHA256_ARM64; codex=codex-aarch64-unknown-linux-musl; codex_sum=$CODEX_SHA256_ARM64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    mkdir -p /out /tmp/bun /tmp/codex; \
    curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${bun}.zip"; \
    echo "${bun_sum}  /tmp/bun.zip" | sha256sum -c -; \
    unzip -q /tmp/bun.zip -d /tmp/bun; \
    install -m 0755 "/tmp/bun/${bun}/bun" /out/bun; \
    curl -fsSL -o /tmp/codex.tar.gz "https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/${codex}.tar.gz"; \
    echo "${codex_sum}  /tmp/codex.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/codex.tar.gz -C /tmp/codex; \
    install -m 0755 "/tmp/codex/${codex}" /out/codex

# ---- The app's one dependency (unpdf, plain JavaScript) ----------------------------------------------------------
# Installed on the build machine's own architecture and copied in: the files are the same on every architecture,
# and Bun does not run under Docker's amd64 emulation on an Apple-silicon machine, where wrangler builds this image.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.2-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- The image -------------------------------------------------------------------------------------------------
FROM debian:trixie-slim
# What the app runs (README "Run it", lib/): Chromium prints the resume PDFs (fonts-liberation is metric-compatible
# with Arial and Helvetica); git and gh clone GitHub sources; unzip reads exports; pandoc converts documents;
# pdftotext (poppler-utils) lets Codex read a PDF. bubblewrap is the Linux sandbox Codex runs model commands in.
# tini is the init: it forwards SIGTERM to the keeper and reaps exited processes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tini git gh unzip pandoc poppler-utils bubblewrap chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
COPY --from=fetch /out/bun /usr/local/bin/bun
COPY --from=fetch /out/codex /usr/local/bin/codex

# The app runs as a user of its own, not root. In a deployed container this sets file ownership more than it
# limits anything (Cloudflare: "every process has the same Linux capabilities as root, regardless of user"), but it
# keeps Chromium and the Codex sandbox on their ordinary non-root paths, here and in a local Docker run.
# /data is the data folder (fresh and empty at every start; the keeper restores into it). /var/lib/keeper is the
# keeper's work folder for copies and downloads, on the same disk so files move by rename.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin egg \
 && mkdir -p /data /var/lib/keeper \
 && chown egg:egg /data /var/lib/keeper

WORKDIR /app
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules node_modules/
COPY server.ts worker.ts ./
COPY lib/ lib/
COPY cloud/keeper.ts cloud/
COPY cloud/lib/ cloud/lib/

ENV DB=/data/egg.db \
    CODEX_HOME=/data/codex \
    EGG_REPOS=/data/repos \
    KEEPER_WORK=/var/lib/keeper \
    EGG_LLM=codex \
    CHROME=/usr/bin/chromium \
    EGG_CHROME_ARGS="--no-sandbox --disable-dev-shm-usage" \
    PORT=8787 \
    KEEPER_PORT=8788
USER egg
EXPOSE 8787 8788
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "cloud/keeper.ts"]
