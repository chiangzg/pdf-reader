import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Message } from "../api/types";

/** 首轮模式：新建会话，触发首轮解读流式 */
export interface NewSessionInit {
  mode: "new";
  text: string;
  variant: "original" | "translated";
  coords: { page: number; x: number; y: number; w: number; h: number }[];
}

/** 续接模式：载入既有会话历史，可继续追问 */
export interface ResumeSessionInit {
  mode: "resume";
  highlightId: number;
}

export type SessionInit = NewSessionInit | ResumeSessionInit;

/** 落库回调：首轮解读完成 → 建会话头 + 首消息，返回新建 highlight id */
export type CreateSessionFn = (
  fullResult: string,
  info: {
    variant: "original" | "translated";
    text: string;
    coords: { page: number; x: number; y: number; w: number; h: number }[];
  }
) => Promise<number | null>;

/**
 * 会话核心逻辑（与渲染解耦）：供 new 模式浮窗(InterpretPanel)与
 * resume 模式手风琴(RightDrawer)共用。
 *
 * 负责：messages state、首轮解读 SSE、追问 chatStream、落库回调、自动滚到底。
 * 两种 init 模式：
 *  - new：首轮解读，SSE 流式 → 首条 assistant → done 后落库拿 sessionId
 *  - resume：载入历史 messages，可继续追问
 */
export function useSession(
  init: SessionInit | null,
  onCreateSession: CreateSessionFn,
  scrollRef: React.RefObject<HTMLElement | null>
) {
  const [messages, setMessages] = useState<Message[]>([]);
  // 本地未落库的临时 id（负数，避免与后端 id 冲突）
  const localSeq = useRef(-1);
  const [streamingId, setStreamingId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingAnswer, setLoadingAnswer] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const initRef = useRef(init);
  initRef.current = init;
  const onCreateRef = useRef(onCreateSession);
  onCreateRef.current = onCreateSession;

  // 追问/首轮后落库拿到的 sessionId（resume 模式下即 init.highlightId）
  const sessionIdRef = useRef<number | null>(null);
  const initAccumRef = useRef("");

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [scrollRef]);

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
    const tempId = localSeq.current--;
    setMessages([{ id: tempId, highlight_id: -1, role: "assistant", content: "", created_at: new Date().toISOString() }]);
    setStreamingId(tempId);
    let doneFired = false;
    controllerRef.current = api.interpretStream(
      cur.text,
      undefined,
      (delta) => {
        setMessages((ms) => ms.map((m) => (m.id === tempId ? { ...m, content: m.content + delta } : m)));
        scrollToBottom();
      },
      () => {
        setStreamingId(null);
      },
      async () => {
        if (doneFired) return;
        doneFired = true;
        setStreamingId(null);
        const full = initAccumRef.current;
        if (!full.trim()) return;
        const id = await onCreateRef.current(full, {
          variant: cur.variant,
          text: cur.text,
          coords: cur.coords,
        });
        if (id != null) sessionIdRef.current = id;
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [init]);

  // 持有最新首轮全文供 done 回调读取
  useEffect(() => {
    const first = messages.find((m) => m.role === "assistant");
    initAccumRef.current = first?.content ?? "";
  }, [messages]);

  // 追问发送
  const sendQuestion = useCallback(() => {
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
        setMessages((ms) => ms.map((m) => (m.id === aTempId ? { ...m, content: m.content + delta } : m)));
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
  }, [input, loadingAnswer, loadingHistory, streamingId, scrollToBottom]);

  // 卸载时取消流
  useEffect(() => () => controllerRef.current?.abort(), []);

  return {
    messages,
    streamingId,
    input,
    setInput,
    loadingHistory,
    loadingAnswer,
    sessionId: sessionIdRef,
    sendQuestion,
  };
}
