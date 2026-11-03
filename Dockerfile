FROM node:22-slim
ENV NODE_ENV=production DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.mjs domain.mjs near.mjs chain.mjs ./
COPY public ./public
COPY contract/res ./contract/res
# Runs as root because Railway mounts volumes owned by root. The process holds no owner key.
EXPOSE 3000
CMD ["node", "server.mjs"]
