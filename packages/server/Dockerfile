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

# 运维脚本必须进镜像。少了它,生产就没有任何重建索引的手段 —— 而改了切块规则
# 之后**必须**用 `import:raw` 把两路索引推到同一代,否则 FTS 和向量对同一个
# chunk_index 指向不同的文字,静默返回错块。
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3001

# tsx 运行时转译 TypeScript,入口 src/index.ts
CMD ["npx", "tsx", "src/index.ts"]
