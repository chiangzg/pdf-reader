# 基于 pdf2zh 官方镜像。
# 不再使用 pdf2zh 自带的 Gradio GUI（pdf2zh -i）：GUI 的 /translate_file 端点
# 经 Gradio 序列化 + special_args 注入后，*envs（翻译器环境变量）会错位，
# 导致 base_url 被空串置空、段落静默翻译失败。
# 改用自定义 FastAPI 服务（server.py）直接调用 pdf2zh.high_level.translate，
# envs 以 JSON dict 传递，彻底消除顺序/错位问题。
FROM byaidu/pdf2zh:latest

# babeldoc 用了 numpy 2.x 已移除的 np.fromstring，改为 np.frombuffer
RUN find /usr/local/lib/python3.12/site-packages/babeldoc -name "*.py" -exec \
    sed -i 's/np\.fromstring(/np.frombuffer(/g' {} + && \
    grep -rn "fromstring" /usr/local/lib/python3.12/site-packages/babeldoc/ || echo "patch 完成，无残留 fromstring"

# 自定义翻译服务（fastapi/uvicorn 已随镜像预装）
COPY server.py /app/server.py

# 启动 FastAPI 翻译服务，监听 7860（与原 Gradio 同端口，便于复用 compose 配置）
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860"]
WORKDIR /app
