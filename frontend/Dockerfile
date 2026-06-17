# ========== stage 1: 构建 ==========
FROM node:20-alpine AS build

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# 复制源码并构建
COPY . .
RUN npm run build

# ========== stage 2: nginx 托管 ==========
FROM nginx:alpine

# 清空默认页面，拷入构建产物
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

# nginx 配置：SPA 回退 + /api 反代到 backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
