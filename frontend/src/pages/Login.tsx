import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";

export default function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "register") {
        await api.register(email, password);
      } else {
        await api.login(email, password);
      }
      await refresh(); // 更新 AuthProvider 的 user 状态，使守卫放行
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <form
        onSubmit={submit}
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
          {mode === "login" ? "登录以继续阅读" : "创建账号"}
        </p>

        <div style={{ display: "flex", background: "var(--bg)", borderRadius: 8, padding: 3, marginBottom: 18, border: "1px solid var(--border)" }}>
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                border: "none",
                borderRadius: 6,
                padding: "7px 0",
                cursor: "pointer",
                fontSize: 13,
                background: mode === m ? "var(--primary)" : "transparent",
                color: mode === m ? "#fff" : "var(--fg)",
                transition: "all .12s",
              }}
            >
              {m === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <label style={labelStyle}>邮箱</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          style={inputStyle}
        />

        <label style={{ ...labelStyle, marginTop: 14 }}>密码</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="至少 6 位"
          required
          minLength={6}
          style={inputStyle}
        />

        {error && (
          <div style={{ color: "#dc2626", fontSize: 13, marginTop: 12, padding: "8px 10px", background: "#fef2f2", borderRadius: 6 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            marginTop: 20,
            background: "var(--primary)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "11px 0",
            fontSize: 14,
            cursor: loading ? "wait" : "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "处理中…" : mode === "login" ? "登录" : "注册"}
        </button>
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "var(--muted)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 14,
  outline: "none",
};
