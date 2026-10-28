FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY scripts/security ./scripts/security
RUN npm ci
COPY index.html ./
COPY vite.config.js ./
COPY server/http/security-headers.js ./server/http/security-headers.js
COPY src ./src
COPY images ./images
COPY audio ./audio
COPY public ./public
ARG VITE_DISCORD_CLIENT_ID=1561284960986599626
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID
ENV VITE_DISCORD_AUTH_ENABLED=true
ENV VITE_DISCORD_WALLET_ENABLED=true
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/game ./src/game
COPY src/version.js ./src/version.js
COPY scripts/admin ./scripts/admin
COPY scripts/lib ./scripts/lib
COPY scripts/security ./scripts/security
RUN mkdir -p /app/data /app/backups && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=4188 APP_ENV=production DATABASE_PATH=/app/data/production.sqlite
EXPOSE 4188
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/index.js"]
