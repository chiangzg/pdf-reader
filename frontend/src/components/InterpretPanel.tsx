import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useDevice } from "../hooks/useDevice";
import BottomSheet from "./BottomSheet";
import MarkdownLite from "./MarkdownLite";

interface Props {
  /** 选中文本；为 null 时关闭 */
  text: string | null;
  context?: string;
  /** PC 模式下浮窗定位锚点（选区 rect）；移动端忽略 */
  anchorRect?: DOMRect | null;
  onClose: () => void;
  /** SSE 解读完成时回传累积全文，供调用方落库。参数为最终全文，空串表示无内容。 */
  onDone?: (fullResult: string) => void;
}

/**
 * 解读结果面板：
 * - PC：选区附近的浮空 popover
 * - 移动端：底部抽屉（下滑关闭）
 * 内容由 SSE 流式驱动，渲染逻辑完全复用。
 */
export default function InterpretPanel({ text, context, anchorRect, onClose, onDone }: Props) {
  const { isMobile } = useDevice();
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // interpretStream 的 done 回调可能被触发两次（SSE done 事件 + 流读完兜底），
  // 用 ref 守卫，确保 onDone 只回传一次。
  const doneFiredRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!text) {
      setContent("");
      setStatus("idle");
      return;
    }
    // 触发解读
    setContent("");
    setStatus("loading");
    setErrorMsg("");
    doneFiredRef.current = false;
    const fireDone = (full: string) => {
      if (doneFiredRef.current) return;
      doneFiredRef.current = true;
      onDoneRef.current?.(full);
    };
    controllerRef.current = api.interpretStream(
      text,
      context,
      (delta) => {
        setStatus((s) => (s === "loading" ? "loading" : s));
        setContent((c) => c + delta);
        // 自动滚到底
        requestAnimationFrame(() => {
          if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        });
      },
      (msg) => {
        setStatus("error");
        setErrorMsg(msg);
      },
      () => {
        setStatus((s) => (s === "loading" ? "done" : s));
        fireDone(contentRef.current);
      }
    );
    return () => controllerRef.current?.abort();
    // content 通过 ref 读取最新值给 done 回调，避免把 content 放进依赖导致重复触发解读
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, context]);

  // 用 ref 持有最新 content，供 SSE done 回调读到累积全文
  const contentRef = useRef("");
  contentRef.current = content;

  const rendered = (
    <div ref={bodyRef} style={{ fontSize: 14, lineHeight: 1.8, color: "var(--fg)" }}>
      {status === "error" ? (
        <div style={{ color: "#dc2626" }}>解读失败：{errorMsg}</div>
      ) : !content && status === "loading" ? (
        <span style={{ color: "var(--muted)" }}>正在解读…</span>
      ) : (
        <MarkdownLite text={content} />
      )}
      {status === "loading" && content && <span className="cursor-blink">▍</span>}
    </div>
  );

  if (isMobile) {
    return (
      <BottomSheet open={!!text} onClose={onClose} heightRatio={0.6}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>AI 解读</strong>
          <button onClick={onClose} style={closeBtn}>关闭</button>
        </div>
        {rendered}
      </BottomSheet>
    );
  }

  // PC popover
  if (!text || !anchorRect) return null;
  // 定位：尽量在选区下方，空间不足则上方
  const margin = 10;
  const panelMaxH = 360;
  const placeBelow = window.innerHeight - anchorRect.bottom > panelMaxH + 40;
  const top = placeBelow ? anchorRect.bottom + margin : Math.max(8, anchorRect.top - panelMaxH - margin);
  // 水平：居中于选区，但限制在视口内
  const panelW = 420;
  const center = anchorRect.left + anchorRect.width / 2;
  let left = center - panelW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: panelW,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: panelMaxH,
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
      <div style={{ padding: 14, overflow: "auto", flex: 1 }}>{rendered}</div>
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

