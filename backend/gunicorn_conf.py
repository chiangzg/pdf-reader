"""Gunicorn 生产配置。

通过环境变量调整 worker 数，默认按 CPU*2+1。
"""
import multiprocessing
import os

HOST = "0.0.0.0"
PORT = "8000"

# Graceful 超时，给 SSE/流式接口留足时间（解读/翻译流式）
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "120"))
graceful_timeout = int(os.environ.get("GUNICORN_GRACEFUL_TIMEOUT", "30"))
keepalive = int(os.environ.get("GUNICORN_KEEPALIVE", "5"))

# worker 数（容器内 CPU 通常可见核数）
workers_env = os.environ.get("GUNICORN_WORKERS")
if workers_env:
    workers = int(workers_env)
else:
    workers = multiprocessing.cpu_count() * 2 + 1

worker_class = "uvicorn.workers.UvicornWorker"

bind = [f"{HOST}:{PORT}"]

# ASGI 异步下，每个 worker 单进程多协程，无需多线程
# 日志
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("GUNICORN_LOGLEVEL", "info")
