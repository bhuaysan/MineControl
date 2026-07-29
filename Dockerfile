# syntax=docker/dockerfile:1
#
# MineControl — Produktiv-Image (siehe README „Deployment").
# Drei Stufen:
#   build   — installiert alle Abhängigkeiten und baut shared + server + web
#   runtime — schlankes Node-Image, das nur das Backend (API + WebSocket) startet
#   web     — Caddy-Image, das die gebaute SPA ausliefert und /api + /ws proxyt
#
# App und Web laufen als getrennte Container (docker-compose.yml). Die
# verwalteten Minecraft-Container erzeugt das Backend über den gemounteten
# Docker-Socket auf dem Host.

# ---------------------------------------------------------------------------
# Build-Stufe: alles bauen (dev-Abhängigkeiten inklusive)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
# Native Module (argon2) brauchen Toolchain; prisma braucht openssl.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
# Reihenfolge wichtig: shared vor server/web (liefert die gebauten Typen/JS),
# prisma-Client vor dem server-Build.
RUN pnpm --filter @minecontrol/shared build \
 && pnpm --filter @minecontrol/server db:generate \
 && pnpm --filter @minecontrol/server build \
 && pnpm --filter @minecontrol/web build

# ---------------------------------------------------------------------------
# Runtime-Stufe: Backend (Fastify) — nur was zum Laufen nötig ist
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
# openssl zur Laufzeit für die prisma-Query-Engine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Das gesamte gebaute Monorepo übernehmen (behält die pnpm-Symlink-Struktur,
# den generierten Prisma-Client und die prisma-CLI für `migrate deploy`).
# Gleiches Base-Image wie build → argon2-Binärmodul ist kompatibel.
COPY --from=build /app /app

COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /app/apps/server
EXPOSE 3000
# Readiness statt Liveness (siehe health.ts) — docker-compose.yml überschreibt
# das Timing, dieser Default greift auch bei einem reinen `docker run`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Kein `USER node` hier: der Container muss beim allerersten Start (und bei
# Upgrades von einer älteren, root-basierten Version) einmalig die
# Eigentümerschaft der gemounteten Volumes übernehmen können (siehe
# entrypoint.sh). Migrations- und App-Prozess selbst laufen danach über
# `setpriv` dauerhaft als `node` (uid 1000) — nicht mehr root.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# ---------------------------------------------------------------------------
# Web-Stufe: Caddy liefert die SPA aus und terminiert TLS
# ---------------------------------------------------------------------------
# Minor-Version gepinnt (statt `:2`) — konsistent mit node:22-bookworm-slim
# oben: reproduzierbarer als eine floatende Major-Tag, ohne bei jedem
# Patch-Release manuell nachziehen zu müssen.
FROM caddy:2.11 AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
