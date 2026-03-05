FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config \
    libsqlite3-dev \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Force scripts ON even if Coolify injects ignore-scripts via env
ENV NPM_CONFIG_IGNORE_SCRIPTS=false
ENV PNPM_IGNORE_SCRIPTS=false

RUN corepack enable

COPY package.json pnpm-lock.yaml ./

# Show effective config (helps debug)
RUN pnpm --version \
 && pnpm config get ignore-scripts || true

RUN pnpm install --frozen-lockfile --prod --ignore-scripts=false

# Force-build native addon and print logs
RUN pnpm rebuild better-sqlite3 --verbose

# Verify the binding exists (fail build if missing)
RUN node -e "require('better-sqlite3'); console.log('better-sqlite3 OK')"

COPY . .

ENV PORT=4007
ENV HOST=0.0.0.0
EXPOSE 4007

CMD ["node", "main.js"]