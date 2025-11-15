# 构建阶段
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 安装构建依赖（包括Python和make，某些npm包需要）
RUN apk add --no-cache python3 make g++

# 复制package文件以优化Docker层缓存
COPY package.json yarn.lock ./

# 安装所有依赖（包括devDependencies）
RUN yarn install --frozen-lockfile --registry https://registry.npmmirror.com/ --ignore-engines

# 复制源代码
COPY . .

# 接收版本号参数并更新 package.json
ARG VERSION
RUN if [ -n "$VERSION" ]; then \
    echo "Updating package.json version to $VERSION"; \
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json; \
    cat package.json | grep version; \
    fi

# 构建应用
RUN yarn build

# 生产阶段
FROM node:18-alpine AS production

# 安装健康检查工具
RUN apk add --no-cache wget

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S jimeng -u 1001

# 设置工作目录
WORKDIR /app

# 复制package文件
COPY package.json yarn.lock ./

# 只安装生产依赖
RUN yarn install --frozen-lockfile --production --registry https://registry.npmmirror.com/ --ignore-engines && \
    yarn cache clean

# 从构建阶段复制构建产物
COPY --from=builder --chown=jimeng:nodejs /app/dist ./dist
COPY --from=builder --chown=jimeng:nodejs /app/public ./public
COPY --from=builder --chown=jimeng:nodejs /app/configs ./configs

# 创建应用需要的目录并设置权限
RUN mkdir -p /app/logs /app/tmp && \
    chown -R jimeng:nodejs /app/logs /app/tmp

# 设置环境变量
ENV SERVER_PORT=5100

# 切换到非root用户
USER jimeng

# 暴露端口
EXPOSE 5100

# 健康检查
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q --spider http://localhost:5100/ping

# 启动应用
CMD ["yarn", "start"]