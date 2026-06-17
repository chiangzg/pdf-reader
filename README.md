# PDF 翻译阅读器

阅读 arxiv 英文论文时自动翻译为中文，并支持划词 AI 解读。

- 双模式阅读：**原版面 + 悬浮翻译** 与 **双语左右对照**，一键切换且不丢失阅读进度
- 划词选中 → 浮窗快捷条 → **AI 解读**（流式输出，PC/移动端自适应）
- DeepSeek 翻译（段落对齐、公式/图表保留）
- 简单账号系统 + 阅读进度记忆
- 全 Docker 部署，PC / 手机自适应

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.11 · FastAPI · Uvicorn/Gunicorn |
| 前端 | React 18 · TypeScript · Vite · pdf.js |
| 数据 | PostgreSQL · Redis |
| 解析 | PyMuPDF（含多列检测） |
| AI | DeepSeek `deepseek-chat` |
| 部署 | Docker Compose · Traefik（自动 HTTPS） |

## 快速部署（服务器）

```bash
# 1. 克隆
git clone <repo-url> pdf-reader && cd pdf-reader

# 2. 配置环境变量
cp .env.example .env
#   填写：DOMAIN / DEEPSEEK_API_KEY / POSTGRES_PASSWORD / SECRET_KEY / ACME_EMAIL

# 3. 准备 Traefik 证书文件
touch proxy/acme.json && chmod 600 proxy/acme.json

# 4. 拉起全部服务
docker compose up -d --build

# 5. 访问
#    https://<你的域名>
```

> 本地开发（无域名/无 HTTPS）：将 `.env` 中 `DOMAIN=localhost`、`ACME_CA_SERVER` 留 staging，访问 `http://localhost`。Traefik 会尝试签发，staging 证书不可信但不影响功能联调。

## 项目结构

```
.
├── docker-compose.yml      # 5 服务编排
├── backend/                # FastAPI 后端
├── frontend/               # React 前端
└── proxy/                  # Traefik 配置
```

## 开发

后端（热重载）：
```bash
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

前端：
```bash
cd frontend && npm install && npm run dev
```

## 文档

详细架构与跨端交互设计见各阶段实现说明。
