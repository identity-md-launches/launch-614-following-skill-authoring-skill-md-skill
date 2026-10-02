FROM node:22-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "src/index.ts"]
