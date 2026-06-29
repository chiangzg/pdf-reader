import { useEffect, useMemo, useRef } from "react";
import type { Highlight } from "../api/types";
import { useSession, type ResumeSessionInit } from "../hooks/useSession";
import SessionView from "./SessionView";

interface Props {
  /** 全量会话（按 created_at 倒序） */
  highlights: Highlight[];
  /** 当前页（1-based）—— 抽屉只列 coords 任一命中当前页的会话 */
  currentPage: number;
  open: boolean;
  onClose: () => void;
  /** 抽屉项悬停联动：驱动正文叠加层对应记录加深 */
  onHover: (id: number | null) => void;
  /** 从正文下划线点击联动过来的高亮项（点击下划线时展开该会话） */
  activeId: number | null;
  /** 展开/收起的受控接口：点击会话项触发 */
  onToggleExpand: (highlightId: number | null) => void;
  /** 当前展开的会话 id（null=无展开） */
  expandedId: number | null;
  onDelete?: (id: number) => void;
  /** 轮询/刷新后由父级注入的展开会话 init（载入消息用） */
}

/**
 * 右侧辅助阅读抽屉（首期功能：划词解读会话列表）。
 *
 * - 列表只展示「当前页」相关的会话（coords 任一命中当前页即展示）。
 * - 点击会话项 → 手风琴就地展开：该项内嵌消息列表（块内限高内部滚动）
 *   + 输入框钉在该展开块底部。其他列表项仍可见可上下滚。
 * - ESC 收起当前展开项。
 * - 鼠标悬停列表项 → onHover(id)，正文对应下划线加深。
 */
export default function RightDrawer({
  highlights,
  currentPage,
  open,
  onClose,
  onHover,
  activeId,
  onToggleExpand,
  expandedId,
  onDelete,
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // 只列当前页相关会话（保持传入的倒序）
  const items = highlights.filter((h) => h.coords.some((c) => c.page === currentPage));

  // ESC 收起展开项
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expandedId != null) {
        e.stopPropagation();
        onToggleExpand(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, expandedId, onToggleExpand]);

  // 展开某项时滚动到该项（处理点开最后一个会话的边界）
  useEffect(() => {
    if (expandedId == null || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-session-item="${expandedId}"]`);
    if (el) {
      // 平滑滚入，让展开块尽量完整可见
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [expandedId]);

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
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            第 {currentPage} 页 · {items.length} 个会话
          </span>
        </div>
        <button onClick={onClose} style={closeBtn} title="收起">
          ✕
        </button>
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {items.length === 0 ? (
          <div
            style={{
              padding: "32px 16px",
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 13,
              lineHeight: 1.8,
            }}
          >
            当前页还没有划词记录
            <div style={{ fontSize: 12, marginTop: 6 }}>
              在正文中选中词句，点「✨ 新建解读」即可开始会话
            </div>
          </div>
        ) : (
          items.map((h) => {
            const expanded = expandedId === h.id;
            const turns = Math.max(1, Math.ceil(h.message_count / 2));
            return (
              <div
                key={h.id}
                data-session-item={h.id}
                onMouseEnter={() => onHover(h.id)}
                onMouseLeave={() => onHover(null)}
                style={{
                  margin: "0 8px 6px",
                  padding: expanded ? 0 : "8px 10px",
                  border: `1px solid ${activeId === h.id ? "var(--primary)" : "var(--border)"}`,
                  borderLeft: `3px solid ${h.variant === "translated" ? "#10b981" : "#f59e0b"}`,
                  borderRadius: 8,
                  background: activeId === h.id ? "rgba(37,99,235,0.05)" : "#fafafa",
                  overflow: "hidden",
                }}
              >
                {/* 折叠态：标题行，点击展开 */}
                <div
                  onClick={() => onToggleExpand(expanded ? null : h.id)}
                  style={{ padding: "8px 10px", cursor: "pointer" }}
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
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
                      {expanded ? "▼ 收起" : "▶ 查看"}
                    </span>
                    {onDelete && !expanded && (
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
                      WebkitLineClamp: expanded ? "unset" : 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {h.text}
                  </div>
                  {!expanded && h.preview && (
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

                {/* 展开态：内嵌会话视图（块内限高 + 输入框钉块底） */}
                {expanded && (
                  <div style={{ padding: "0 10px 10px", borderTop: "1px solid var(--border)" }}>
                    {onDelete && (
                      <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 0 2px" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(h.id);
                          }}
                          style={delBtn}
                          title="删除会话"
                        >
                          删除会话
                        </button>
                      </div>
                    )}
                    <ExpandedSession
                      highlightId={h.id}
                      listHeightStyle={{ maxHeight: 280, marginTop: 6 }}
                    />
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

/**
 * 展开的会话视图：自持 useSession 实例（resume 模式载入历史）。
 * 抽成子组件以隔离 hook 状态，避免未展开项也创建实例。
 */
function ExpandedSession({
  highlightId,
  listHeightStyle,
}: {
  highlightId: number;
  listHeightStyle: React.CSSProperties;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // useMemo 稳定 init 引用：否则每次渲染 new 一个对象字面量，
  // useSession 的 useEffect 依赖 [init] 会每次重跑 → listMessages 死循环。
  const init = useMemo<ResumeSessionInit>(
    () => ({ mode: "resume", highlightId }),
    [highlightId]
  );
  // resume 不落库，onCreateSession 不会被调用（仅 new 模式会），给个 noop 满足类型
  const session = useSession(init, async () => null, scrollRef);
  return (
    <SessionView
      messages={session.messages}
      streamingId={session.streamingId}
      input={session.input}
      setInput={session.setInput}
      loadingHistory={session.loadingHistory}
      loadingAnswer={session.loadingAnswer}
      sessionReady
      onSend={session.sendQuestion}
      scrollRef={scrollRef}
      listHeightStyle={listHeightStyle}
    />
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
