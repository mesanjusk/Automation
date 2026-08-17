FROM node:20-slim
WORKDIR /app
COPY apps/test-site/package.json ./
RUN npm install
COPY apps/test-site/server.mjs ./
EXPOSE 4100
CMD ["node", "server.mjs"]
