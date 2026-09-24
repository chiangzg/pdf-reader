# PDF 翻译阅读器

阅读 arxiv 英文论文时自动翻译为中文，并支持划词 AI 解读。

- 双模式阅读：**原版面 + 悬浮翻译** 与 **双语左右对照**，一键切换且不丢失阅读进度
- 划词选中 → 浮窗快捷条 → **AI 解读**（流式输出，PC/移动端自适应）
- DeepSeek 翻译（段落对齐、公式/图表保留）
- OIDC 统一认证登录（[Authentik](https://goauthentik.io)）+ 阅读进度记忆
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
#   填写：DOMAIN / DEEPSEEK_API_KEY / POSTGRES_PASSWORD / SECRET_KEY / ACME_EMAIL / OIDC_*

# 3. 准备 Traefik 证书文件
touch proxy/acme.json && chmod 600 proxy/acme.json

# 4. 拉起全部服务
docker compose up -d --build

# 5. 访问
#    https://<你的域名>
```

> 本地开发（无域名/无 HTTPS）：将 `.env` 中 `DOMAIN=localhost`、`ACME_CA_SERVER` 留 staging，访问 `http://localhost`。Traefik 会尝试签发，staging 证书不可信但不影响功能联调。

## 统一认证（Authentik / OIDC）

登录采用后端驱动的 OIDC 授权码模式，对接 Authentik（任何标准 OIDC Provider 均可）。

### 1. 在 Authentik 中创建 Provider 与应用

1. **Applications → Providers → Create → OAuth2/OpenID Provider**
   - Authorization flow：默认（implicit consent 可选）
   - Client type：**Confidential**
   - Redirect URIs：`https://<你的域名>/api/auth/oidc/callback`（须精确匹配）
   - Signing Key：默认即可
2. **Applications → Applications → Create**，绑定上一步的 Provider。
3. 记下 Provider 的 **Client ID / Client Secret**，以及 issuer（形如 `https://auth.example.com/application/o/<应用-slug>/`，注意结尾带 `/`）。
4. 如需应用内登出后同步登出 Authentik 全局会话（默认行为）：
   在 Provider 的 **Advanced protocol settings** 中，登出相关设置保持默认（Authentik 支持 RP-Initiated Logout），
   并确保 `https://<你的域名>/login` 可作为登出回跳地址（Authentik 较新版本可在应用 Launch/Redirect 设置中登记）。

### 2. 配置 `.env`

```bash
OIDC_ISSUER=https://auth.example.com/application/o/pdf-reader/
OIDC_CLIENT_ID=<client-id>
OIDC_CLIENT_SECRET=<client-secret>
OIDC_REDIRECT_BASE=https://<你的域名>   # 生产建议显式填写
```

### 3. 账号关联规则

- 首次 OIDC 登录时按 `email` 自动关联既有本地账号，论文/进度/解读历史全部保留。
- 之后以 Authentik 的 `sub` 作为稳定标识识别用户；Authentik 侧改邮箱会自动同步（新邮箱未被占用时）。
- 密码登录已移除，用户与密码统一由 Authentik 管理；应用侧仍保留独立的 7 天会话 cookie。

## 项目结构

```
.
├── docker-compose.yml      # 5 服务编排（postgres / pdf2zh / backend / frontend / proxy）
├── backend/                # FastAPI 后端
├── frontend/               # React 前端
├── pdf2zh/                 # PDF 翻译服务（FastAPI 包装 pdf2zh.high_level，envs 用 JSON 传递）
│   ├── Dockerfile
│   └── server.py
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
