import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Message } from "../api/types";
import { useDevice } from "../hooks/useDevice";
import BottomSheet from "./BottomSheet";
import MarkdownLite from "./MarkdownLite";

export interface NewSessionInit {
  /** 首轮模式：新建会话，触发首轮解读流式 */
  mode: "new";
  text: string;
  variant: "original" | "translated";
  /** 归一化坐标，落库时用 */
  coords: { page: number; x: number; y: number; w: number; h: number }[];
}

export interface ResumeSessionInit {
  /** 续接模式：载入既有会话历史，可继续追问 */
  mode: "resume";
  highlightId: number;
}

export type SessionInit = NewSessionInit | ResumeSessionInit;

interface Props {
  /** 会话初始化描述；null 时关闭面板 */
  init: SessionInit | null;
  /** PC 模式下浮窗定位锚点（首轮选区 rect） */
  anchorRect?: DOMRect | null;
  onClose: () => void;
  /** 首轮解读完成 → 落库（建会话头 + 首消息）。返回新建的 highlight。 */
  onCreateSession: (fullResult: string, info: {
    variant: "original" | "translated";
    text: string;
    coords: { page: number; x: number; y: number; w: number; h: number }[];
  }) => Promise<number | null>;
}

/**
 * 解读会话面板：
 * - PC：选区附近的浮空 popover（多轮对话窗口）
 * - 移动端：底部抽屉（下滑关闭）
 *
 * 两种初始化模式：
 *  - new：首轮解读，SSE 流式 → 首条 assistant 消息 → done 后落库拿 sessionId
 *  - resume：续接，先载入历史 messages，底部输入框追问
 *
 * 追问：append user → chatStream(sessionId) → 流入 assistant。
 */
export default function InterpretPanel({ init, anchorRect, onClose, onCreateSession }: Props) {
  const { isMobile } = useDevice();
  const [messages, setMessages] = useState<Message[]>([]);
  // 本地未落库的临时 id（负数，避免与后端 id 冲突）
  const localSeq = useRef(-1);
  const [streamingId, setStreamingId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingAnswer, setLoadingAnswer] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(init);
  initRef.current = init;

  // 追问/首轮后落库拿到的 sessionId（resume 模式下即 init.highlightId）
  const sessionIdRef = useRef<number | null>(null);
  const variantRef = useRef<"original" | "translated">("original");
  const coordsRef = useRef<{ page: number; x: number; y: number; w: number; h: number }[]>([]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    });
  };

  // init 变化：重置并按模式启动
  useEffect(() => {
    const cur = initRef.current;
    if (!cur) {
      setMessages([]);
      sessionIdRef.current = null;
      return;
    }
    controllerRef.current?.abort();
    setMessages([]);

    if (cur.mode === "resume") {
      sessionIdRef.current = cur.highlightId;
      setLoadingHistory(true);
      api
        .listMessages(cur.highlightId)
        .then((msgs) => {
          setMessages(msgs);
          scrollToBottom();
        })
        .catch(() => {
          /* 载入失败则空会话 */
        })
        .finally(() => setLoadingHistory(false));
      return;
    }

    // new 模式：首轮解读
    sessionIdRef.current = null;
    variantRef.current = cur.variant;
    coordsRef.current = cur.coords;
    const tempId = localSeq.current--;
    // 占位 assistant 消息，流式填充
    setMessages([{ id: tempId, highlight_id: -1, role: "assistant", content: "", created_at: new Date().toISOString() }]);
    setStreamingId(tempId);
    let doneFired = false;
    controllerRef.current = api.interpretStream(
      cur.text,
      undefined,
      (delta) => {
        setMessages((ms) =>
          ms.map((m) => (m.id === tempId ? { ...m, content: m.content + delta } : m))
        );
        scrollToBottom();
      },
      () => {
        // error：把占位消息标记为失败（保留已流入部分）
        setStreamingId(null);
      },
      async () => {
        if (doneFired) return;
        doneFired = true;
        setStreamingId(null);
        // 取最终全文
        const full = initAccumRef.current;
        if (!full.trim()) return;
        const id = await onCreateSession(full, {
          variant: cur.variant,
          text: cur.text,
          coords: cur.coords,
        });
        if (id != null) sessionIdRef.current = id;
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [init]);

  // 用 ref 持有最新首轮全文供 done 回调读取
  const initAccumRef = useRef("");
  useEffect(() => {
    const first = messages.find((m) => m.role === "assistant");
    initAccumRef.current = first?.content ?? "";
  }, [messages]);

  // 追问发送
  const sendQuestion = () => {
    const q = input.trim();
    const sid = sessionIdRef.current;
    if (!q || loadingAnswer || loadingHistory || streamingId != null) return;
    if (sid == null) return; // 首轮未落库完成前不允许追问

    const userMsg: Message = {
      id: localSeq.current--,
      highlight_id: sid,
      role: "user",
      content: q,
      created_at: new Date().toISOString(),
    };
    const aTempId = localSeq.current--;
    const aMsg: Message = {
      id: aTempId,
      highlight_id: sid,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };
    setMessages((ms) => [...ms, userMsg, aMsg]);
    setInput("");
    setStreamingId(aTempId);
    setLoadingAnswer(true);

    controllerRef.current = api.chatStream(
      sid,
      q,
      (delta) => {
        setMessages((ms) =>
          ms.map((m) => (m.id === aTempId ? { ...m, content: m.content + delta } : m))
        );
        scrollToBottom();
      },
      () => {
        setStreamingId(null);
        setLoadingAnswer(false);
      },
      () => {
        setStreamingId(null);
        setLoadingAnswer(false);
      }
    );
  };

  useEffect(() => () => controllerRef.current?.abort(), []);

  const rendered = (
    <div
      ref={bodyRef}
      style={{
        fontSize: 14,
        lineHeight: 1.8,
        color: "var(--fg)",
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
      }}
    >
      {loadingHistory && messages.length === 0 ? (
        <span style={{ color: "var(--muted)" }}>载入会话…</span>
      ) : messages.length === 0 ? (
        <span style={{ color: "var(--muted)" }}>正在解读…</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role} streaming={streamingId === m.id}>
              {m.role === "assistant" ? <MarkdownLite text={m.content} /> : m.content}
            </MessageBubble>
          ))}
        </div>
      )}
    </div>
  );

  const footer = (
    <div style={{ display: "flex", gap: 8, paddingTop: 8 }}>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendQuestion();
          }
        }}
        placeholder={sessionIdRef.current == null ? "解读完成后可追问…" : "追问…（Enter 发送）"}
        disabled={sessionIdRef.current == null || loadingAnswer || streamingId != null}
        style={{
          flex: 1,
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: 13,
          outline: "none",
          background: "#fff",
          color: "var(--fg)",
        }}
      />
      <button
        onClick={sendQuestion}
        disabled={sessionIdRef.current == null || loadingAnswer || streamingId != null || !input.trim()}
        style={{
          background: "var(--primary)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "0 14px",
          cursor: "pointer",
          fontSize: 13,
          opacity: sessionIdRef.current == null || loadingAnswer ? 0.5 : 1,
        }}
      >
        发送
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <BottomSheet open={init != null} onClose={onClose} heightRatio={0.7}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>AI 解读</strong>
          <button onClick={onClose} style={closeBtn}>关闭</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", height: "80%" }}>
          {rendered}
          {footer}
        </div>
      </BottomSheet>
    );
  }

  // PC popover
  if (!init) return null;
  const panelMaxH = 420;
  const panelW = 460;
  const margin = 10;
  let top: number;
  let left: number;
  if (anchorRect) {
    // 有选区锚点：贴选区下方/上方
    const placeBelow = window.innerHeight - anchorRect.bottom > panelMaxH + 40;
    top = placeBelow ? anchorRect.bottom + margin : Math.max(8, anchorRect.top - panelMaxH - margin);
    const center = anchorRect.left + anchorRect.width / 2;
    left = center - panelW / 2;
  } else {
    // 无锚点（续接/抽屉点击打开）：屏幕居中
    top = Math.max(8, (window.innerHeight - panelMaxH) / 2);
    left = (window.innerWidth - panelW) / 2;
  }
  left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: panelW,
        maxWidth: "calc(100vw - 16px)",
        height: panelMaxH,
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,.2)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <strong style={{ fontSize: 14 }}>AI 解读</strong>
        <button onClick={onClose} style={closeBtn}>关闭</button>
      </div>
      <div style={{ padding: "0 14px 14px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {rendered}
        {footer}
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
    <div style={{ alignSelf: isUser ? "flex-end" : "flex-start", maxWidth: "88%" }}>
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

const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "3px 10px",
  cursor: "pointer",
  fontSize: 12,
  color: "var(--muted)",
};
