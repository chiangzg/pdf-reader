import type { Highlight } from "../api/types";

interface Props {
  /** 全量会话（按 created_at 倒序） */
  highlights: Highlight[];
  /** 当前页（1-based）—— 抽屉只列 coords 任一命中当前页的会话 */
  currentPage: number;
  open: boolean;
  onClose: () => void;
  /** 抽屉项悬停联动：驱动正文叠加层对应记录加深 */
  onHover: (id: number | null) => void;
  /** 从正文下划线点击联动过来的高亮项 */
  activeId: number | null;
  /** 点击会话项 → 打开会话视图（载入消息） */
  onOpenSession: (highlightId: number) => void;
  onDelete?: (id: number) => void;
}

/**
 * 右侧辅助阅读抽屉（首期功能：划词解读会话列表）。
 * - 列表只展示「当前页」相关的会话（coords 任一命中当前页即展示，跨页会话在所涉各页都出现）。
 * - 鼠标悬停列表项 → onHover(id)，正文对应下划线加深。
 * - 点击会话项 → 打开会话视图（载入该会话全部消息，可继续追问）。
 */
export default function RightDrawer({
  highlights,
  currentPage,
  open,
  onClose,
  onHover,
  activeId,
  onOpenSession,
  onDelete,
}: Props) {
  if (!open) return null;

  // 只列当前页相关会话（保持传入的倒序）
  const items = highlights.filter((h) => h.coords.some((c) => c.page === currentPage));

  return (
    <aside
      style={{
        width: 320,
        flex: "0 0 auto",
        height: "100%",
        background: "#fff",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <strong style={{ fontSize: 14 }}>划词记录</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>第 {currentPage} 页 · {items.length} 个会话</span>
        </div>
        <button onClick={onClose} style={closeBtn} title="收起">
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {items.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13, lineHeight: 1.8 }}>
            当前页还没有划词记录
            <div style={{ fontSize: 12, marginTop: 6 }}>在正文中选中词句，点「✨ 新建解读」即可开始会话</div>
          </div>
        ) : (
          items.map((h) => {
            const active = activeId === h.id;
            const turns = Math.max(1, Math.ceil(h.message_count / 2));
            return (
              <div
                key={h.id}
                onMouseEnter={() => onHover(h.id)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onOpenSession(h.id)}
                style={{
                  margin: "0 8px 6px",
                  padding: "8px 10px",
                  border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
                  borderLeft: `3px solid ${h.variant === "translated" ? "#10b981" : "#f59e0b"}`,
                  borderRadius: 8,
                  background: active ? "rgba(37,99,235,0.05)" : "#fafafa",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: h.variant === "translated" ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)",
                      color: h.variant === "translated" ? "#059669" : "#b45309",
                    }}
                  >
                    {h.variant === "translated" ? "译文" : "原文"}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{turns} 轮</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{formatTime(h.created_at)}</span>
                  {onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(h.id);
                      }}
                      style={delBtn}
                      title="删除会话"
                    >
                      删除
                    </button>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "var(--fg)",
                    fontWeight: 500,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {h.text}
                </div>
                {h.preview && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      marginTop: 4,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {h.preview}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "3px 8px",
  cursor: "pointer",
  fontSize: 12,
  color: "var(--muted)",
};

const delBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: 11,
  color: "#dc2626",
  marginLeft: "auto",
  padding: 0,
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (sameDay) return `${hh}:${mm}`;
    const mo = d.getMonth() + 1;
    const da = d.getDate();
    return `${mo}/${da} ${hh}:${mm}`;
  } catch {
    return "";
  }
}
