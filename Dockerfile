FROM node:22-slim
ENV NODE_ENV=production DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY contract/res ./contract/res
# Runs as root because Railway mounts volumes owned by root. The process holds no customer owner keys.
EXPOSE 3000
CMD ["node", "src/server.mjs"]
