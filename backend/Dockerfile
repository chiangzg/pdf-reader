# ---------- build stage ----------
FROM python:3.11-slim AS base

# 设置时区与编码
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=Asia/Shanghai \
    LANG=C.UTF-8

WORKDIR /app

# 系统依赖（curl 仅用于健康检查）
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

# pip 使用国内镜像加速（构建期），HuggingFace 端点镜像（运行期下载模型）
ENV PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
    HF_ENDPOINT=https://hf-mirror.com

# 先装依赖（利用层缓存）
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# 复制源码
COPY . .

# 创建上传/译文目录
RUN mkdir -p /app/uploads /app/translations

EXPOSE 8000

# 生产用 gunicorn + uvicorn worker；开发时可在 compose 覆盖为 uvicorn --reload
CMD ["gunicorn", "app.main:app", "-c", "gunicorn_conf.py"]
