FROM node:22-alpine

# git is needed at runtime (the app shells out to it to commit + push)
RUN apk add --no-cache git openssh-client

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server.mjs"]
