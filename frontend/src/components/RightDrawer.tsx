import { useState } from "react";
import type { Highlight } from "../api/types";
import MarkdownLite from "./MarkdownLite";

interface Props {
  /** 全量划词记录（按 created_at 倒序） */
  highlights: Highlight[];
  /** 当前页（1-based）—— 抽屉只列 coords 任一命中当前页的记录 */
  currentPage: number;
  open: boolean;
  onClose: () => void;
  /** 抽屉项悬停联动：驱动正文叠加层对应记录加深 */
  onHover: (id: number | null) => void;
  /** 点击下划线/列表项联动：从正文打开解读 */
  activeId: number | null;
  onDelete?: (id: number) => void;
}

/**
 * 右侧辅助阅读抽屉（首期功能：划词 AI 解读历史）。
 * - 列表只展示「当前页」相关的记录（coords 任一命中当前页即展示，跨页记录在所涉各页都出现）。
 * - 鼠标悬停列表项 → onHover(id)，正文对应下划线加深。
 * - 点击列表项 → 展开该记录的 AI 解读全文。
 */
export default function RightDrawer({
  highlights,
  currentPage,
  open,
  onClose,
  onHover,
  activeId,
  onDelete,
}: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // 只列当前页相关记录（保持传入的倒序）
  const items = highlights.filter((h) => h.coords.some((c) => c.page === currentPage));

  const handleClick = (h: Highlight) => {
    setExpandedId((cur) => (cur === h.id ? null : h.id));
  };

  if (!open) return null;

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
          <span style={{ fontSize: 12, color: "var(--muted)" }}>第 {currentPage} 页 · {items.length} 条</span>
        </div>
        <button onClick={onClose} style={closeBtn} title="收起">
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {items.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13, lineHeight: 1.8 }}>
            当前页还没有划词记录
            <div style={{ fontSize: 12, marginTop: 6 }}>在正文中选中词句，点「✨ AI 解读」即可记录</div>
          </div>
        ) : (
          items.map((h) => {
            const expanded = expandedId === h.id;
            const active = activeId === h.id;
            return (
              <div
                key={h.id}
                onMouseEnter={() => onHover(h.id)}
                onMouseLeave={() => onHover(null)}
                style={{
                  margin: "0 8px 6px",
                  padding: "8px 10px",
                  border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
                  borderLeft: `3px solid ${h.variant === "translated" ? "#10b981" : "#f59e0b"}`,
                  borderRadius: 8,
                  background: active ? "rgba(37,99,235,0.05)" : "#fafafa",
                  cursor: "pointer",
                }}
                onClick={() => handleClick(h)}
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
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{formatTime(h.created_at)}</span>
                  {onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(h.id);
                      }}
                      style={delBtn}
                      title="删除"
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
                    display: "-webkit-box",
                    WebkitLineClamp: expanded ? "unset" : 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {h.text}
                </div>
                {expanded && (
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: "1px dashed var(--border)",
                      fontSize: 13,
                      lineHeight: 1.8,
                      color: "var(--fg)",
                    }}
                  >
                    <MarkdownLite text={h.result} />
                  </div>
                )}
                {!expanded && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>点击查看 AI 解读</div>
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
