# Forged Web — build from the repository root:  docker build -f web/Dockerfile -t forged-web .
FROM node:22-alpine AS build
WORKDIR /src
COPY src ./src
COPY web ./web
RUN node web/build.js /out/public

FROM node:22-alpine
LABEL org.opencontainers.image.title="Forged Web" \
      org.opencontainers.image.description="Forged layered photo editor for the browser, self-hosted" \
      org.opencontainers.image.source="https://github.com/brucewindsornz-sudo/forged" \
      org.opencontainers.image.licenses="MIT"
# A few open fonts for the Type tool; mount more at /fonts
RUN apk add --no-cache font-dejavu font-liberation font-noto font-opensans font-croscore \
 && mkdir -p /data /fonts && chown node:node /data
WORKDIR /app
COPY web/server.js web/package.json ./
COPY src/fonts.js ./fonts.js
COPY --from=build /out/public ./public
ENV NODE_ENV=production PORT=8080 FORGED_DATA=/data
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.js"]
