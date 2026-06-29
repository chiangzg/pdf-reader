import { useRef } from "react";
import type { RefObject } from "react";
import type { Message } from "../api/types";
import MarkdownLite from "./MarkdownLite";

interface Props {
  messages: Message[];
  streamingId: number | null;
  input: string;
  setInput: (v: string) => void;
  loadingHistory: boolean;
  loadingAnswer: boolean;
  /** 首轮是否已落库（sessionIdRef.current）；未落库前禁用追问 */
  sessionReady: boolean;
  onSend: () => void;
  /** 滚动容器的 ref（由调用方持有，传给消息列表 div） */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 消息列表容器的高度样式：浮窗用 flex:1+minHeight:0；手风琴用固定 maxHeight */
  listHeightStyle?: React.CSSProperties;
}

/**
 * 会话视图核心渲染：消息气泡列表（可滚动）+ 底部追问输入框。
 * 与 useSession hook 配合，供 new 模式浮窗与 resume 模式手风琴共用。
 * 高度策略由 listHeightStyle 注入，使同一组件适配不同容器。
 */
export default function SessionView({
  messages,
  streamingId,
  input,
  setInput,
  loadingHistory,
  loadingAnswer,
  sessionReady,
  onSend,
  scrollRef,
  listHeightStyle,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const disabled = !sessionReady || loadingAnswer || streamingId != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        ref={scrollRef as React.RefObject<HTMLDivElement>}
        style={{
          fontSize: 13,
          lineHeight: 1.7,
          color: "var(--fg)",
          overflowY: "auto",
          minHeight: 0,
          ...listHeightStyle,
        }}
      >
        {loadingHistory && messages.length === 0 ? (
          <span style={{ color: "var(--muted)" }}>载入会话…</span>
        ) : messages.length === 0 ? (
          <span style={{ color: "var(--muted)" }}>正在解读…</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map((m) => (
              <MessageBubble key={m.id} role={m.role} streaming={streamingId === m.id}>
                {m.role === "assistant" ? <MarkdownLite text={m.content} /> : m.content}
              </MessageBubble>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, paddingTop: 8, flexShrink: 0 }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={1}
          placeholder={sessionReady ? "追问…（Enter 发送，Shift+Enter 换行）" : "解读完成后可追问…"}
          disabled={disabled}
          style={{
            flex: 1,
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "7px 10px",
            fontSize: 13,
            outline: "none",
            background: "#fff",
            color: "var(--fg)",
            resize: "none",
            maxHeight: 96,
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={onSend}
          disabled={disabled || !input.trim()}
          style={{
            background: "var(--primary)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "0 14px",
            cursor: "pointer",
            fontSize: 13,
            opacity: disabled || !input.trim() ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  streaming,
  children,
}: {
  role: string;
  streaming: boolean;
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div style={{ alignSelf: isUser ? "flex-end" : "flex-start", maxWidth: "90%" }}>
      <div
        style={{
          background: isUser ? "var(--primary)" : "#f3f4f6",
          color: isUser ? "#fff" : "var(--fg)",
          borderRadius: 10,
          padding: "8px 12px",
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        {children}
        {streaming && <span className="cursor-blink">▍</span>}
      </div>
    </div>
  );
}
