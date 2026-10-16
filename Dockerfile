# Testrify cloud runner — executes browser tests on Railway.
# The official Playwright image bundles Chromium/Firefox/WebKit + every system dep; the tag is
# pinned to the app's @playwright/test minor (1.61) so the preinstalled browsers line up.
FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app

# Install JS deps first for layer caching. `npm ci` installs the exact versions in the committed
# package-lock.json (the set the app is built and tested with) — a fresh `npm install` floats to
# the newest matching releases, which broke the build once upstream peer ranges drifted.
# --ignore-scripts skips Playwright's browser postinstall (browsers already live in the image).
# tsx runs the TS runner entry directly.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
  && npm install -g tsx@4

# Guarantee the bundled browser builds match whatever @playwright/test npm actually resolved — the
# ^1.61 range can float past the image's pinned browsers. Cloud runs support chromium/firefox/webkit
# (chrome/msedge channels need the real branded browser, which isn't in this image).
RUN npx --yes playwright install chromium firefox webkit

# App source: the shared engine (src/lib/*), tsconfig.json (for the @/ alias), and runner/server.ts.
COPY . .

ENV NODE_ENV=production
# Railway injects PORT; runner/server.ts reads it.
CMD ["tsx", "runner/server.ts"]
