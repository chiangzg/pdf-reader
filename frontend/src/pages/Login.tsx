import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

/** OIDC（Authentik）统一认证登录页。

 登录跳转由后端驱动：整页导航到 /api/auth/oidc/login，
 授权与回调都在后端完成，成功后后端 302 回 /。
 失败时后端重定向回本页并带 ?error=...。
*/
export default function Login() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [error] = useState<string | null>(() => searchParams.get("error"));
  const [redirecting, setRedirecting] = useState(false);

  // 错误展示后清理 URL 参数，避免刷新重复显示
  useEffect(() => {
    if (error) setSearchParams({}, { replace: true });
  }, [error, setSearchParams]);

  const startLogin = () => {
    setRedirecting(true);
    window.location.href = "/api/auth/oidc/login";
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          background: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 28,
          boxShadow: "0 4px 20px rgba(0,0,0,.06)",
        }}
      >
        <h1 style={{ fontSize: 20, margin: "0 0 6px", textAlign: "center" }}>PDF 翻译阅读器</h1>
        <p style={{ color: "var(--muted)", textAlign: "center", fontSize: 13, margin: "0 0 22px" }}>
          登录以继续阅读
        </p>

        {error && (
          <div
            style={{
              color: "#dc2626",
              fontSize: 13,
              marginBottom: 16,
              padding: "8px 10px",
              background: "#fef2f2",
              borderRadius: 6,
              wordBreak: "break-all",
            }}
          >
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={startLogin}
          disabled={redirecting}
          style={{
            width: "100%",
            background: "var(--primary)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "11px 0",
            fontSize: 14,
            cursor: redirecting ? "wait" : "pointer",
            fontWeight: 600,
          }}
        >
          {redirecting ? "正在跳转…" : "使用统一身份认证登录"}
        </button>
        <p style={{ color: "var(--muted)", textAlign: "center", fontSize: 12, margin: "14px 0 0" }}>
          将跳转至统一认证服务（SSO）完成登录
        </p>
      </div>
    </div>
  );
}
