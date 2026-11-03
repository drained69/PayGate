FROM node:22-slim
ENV NODE_ENV=production DATA_DIR=/tmp/nocturne
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.mjs domain.mjs near.mjs chain.mjs seed.mjs ./
COPY public ./public
COPY contract/res ./contract/res
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
