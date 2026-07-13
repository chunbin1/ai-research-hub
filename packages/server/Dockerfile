FROM node:20-alpine

WORKDIR /app

# better-sqlite3 是原生模块 — alpine 需要编译工具链(g++ 支持 c++20,可源码构建)
RUN apk add --no-cache python3 make g++

# 装依赖。--legacy-peer-deps 容忍宽松 peer;devDependencies 保留(tsx/typescript 运行时需要)
COPY package.json ./
RUN npm install --legacy-peer-deps

# 源码 + tsconfig(tsx 运行时读取)
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3001

# tsx 运行时转译 TypeScript,入口 src/index.ts
CMD ["npx", "tsx", "src/index.ts"]
