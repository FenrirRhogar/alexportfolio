FROM node:22-alpine

# ffmpeg turns uploaded .mov videos into .mp4 (lib/video.mjs)
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server.mjs"]
