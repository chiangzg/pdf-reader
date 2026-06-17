# 基于 pdf2zh 官方镜像，patch numpy 2.x 兼容性（np.fromstring → np.frombuffer）
FROM byaidu/pdf2zh:latest

# babeldoc 用了 numpy 2.x 已移除的 np.fromstring，改为 np.frombuffer
RUN find /usr/local/lib/python3.12/site-packages/babeldoc -name "*.py" -exec \
    sed -i 's/np\.fromstring(/np.frombuffer(/g' {} + && \
    grep -rn "fromstring" /usr/local/lib/python3.12/site-packages/babeldoc/ || echo "patch 完成，无残留 fromstring"
