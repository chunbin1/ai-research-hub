FROM node:24-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
# 加上 KaTeX 之后，vite 在 rendering chunks 时会超过镜像里 Node 默认大约
# 512MB 的堆（部署日志：Reached heap limit，约 480MB）。只抬构建这一步。
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
