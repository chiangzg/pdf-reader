import { useEffect, useRef, useState } from "react";
import { useDevice } from "../hooks/useDevice";
import { useSession, type CreateSessionFn, type NewSessionInit } from "../hooks/useSession";
import BottomSheet from "./BottomSheet";
import SessionView from "./SessionView";

interface Props {
  /** 首轮解读初始化；null 时关闭 */
  init: NewSessionInit | null;
  /** 浮窗初始定位锚点（首轮选区 rect） */
  anchorRect?: DOMRect | null;
  onClose: () => void;
  onCreateSession: CreateSessionFn;
}

const PANEL_W = 460;
const PANEL_MAX_H = 460;

/**
 * 首轮解读浮窗（仅 new 模式）。
 *
 * - PC：可拖动的浮空 popover。标题栏为拖拽 handle，可任意拖动到视口内。
 *   首次按选区锚点定位，拖动后跟随用户放置位置。
 * - 移动端：底部抽屉（下滑关闭）。
 *
 * 首轮解读 SSE 流式 → done 后落库（onCreateSession）拿 sessionId，可继续追问。
 *
 * 续接（resume）不在本组件，由 RightDrawer 手风琴内联展开处理。
 */
export default function InterpretPanel({ init, anchorRect, onClose, onCreateSession }: Props) {
  const { isMobile } = useDevice();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const session = useSession(init, onCreateSession, scrollRef);

  // 浮窗位置（拖动用）
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // 拖拽状态
  const draggingRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 初始定位：有锚点贴选区下方/上方；无锚点居中。init 变化时重算（仅当尚未拖动过）
  useEffect(() => {
    if (!init) {
      setPos(null);
      return;
    }
    const margin = 10;
    let top: number;
    let left: number;
    if (anchorRect) {
      const placeBelow = window.innerHeight - anchorRect.bottom > PANEL_MAX_H + 40;
      top = placeBelow ? anchorRect.bottom + margin : Math.max(8, anchorRect.top - PANEL_MAX_H - margin);
      const center = anchorRect.left + anchorRect.width / 2;
      left = center - PANEL_W / 2;
    } else {
      top = Math.max(8, (window.innerHeight - PANEL_MAX_H) / 2);
      left = (window.innerWidth - PANEL_W) / 2;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - PANEL_W - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - 80));
    setPos({ left, top });
  }, [init, anchorRect]);

  // 拖动：mousedown 记录起点
  const onHandleMouseDown = (e: React.MouseEvent) => {
    if (!pos) return;
    // 不拦截左键以外的点击
    if (e.button !== 0) return;
    draggingRef.current = { startX: e.clientX, startY: e.clientY, origLeft: pos.left, origTop: pos.top };
    // 阻止选中文本
    e.preventDefault();
  };

  // 全局 mousemove/mouseup（拖动期间）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      let left = d.origLeft + dx;
      let top = d.origTop + dy;
      left = Math.max(0, Math.min(left, window.innerWidth - PANEL_W));
      top = Math.max(0, Math.min(top, window.innerHeight - 40)); // 至少留标题栏可见
      setPos({ left, top });
    };
    const onUp = () => {
      draggingRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const sessionReady = session.sessionId.current != null;

  if (isMobile) {
    return (
      <BottomSheet open={init != null} onClose={onClose} heightRatio={0.7}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>AI 解读</strong>
          <button onClick={onClose} style={closeBtn}>关闭</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", height: "80%" }}>
          <SessionView
            messages={session.messages}
            streamingId={session.streamingId}
            input={session.input}
            setInput={session.setInput}
            loadingHistory={session.loadingHistory}
            loadingAnswer={session.loadingAnswer}
            sessionReady={sessionReady}
            onSend={session.sendQuestion}
            scrollRef={scrollRef}
            listHeightStyle={{ flex: 1, minHeight: 0 }}
          />
        </div>
      </BottomSheet>
    );
  }

  if (!init || !pos) return null;
  const dragging = draggingRef.current != null;

  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: PANEL_W,
        maxWidth: "calc(100vw - 16px)",
        height: PANEL_MAX_H,
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,.2)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden", // 兜底：固定尺寸，内部列表溢出由其自身滚动处理，弹窗不被撑破
        userSelect: dragging ? "none" : "auto",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        onMouseDown={onHandleMouseDown}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          cursor: "move",
          background: dragging ? "rgba(37,99,235,0.04)" : "transparent",
        }}
        title="拖动移动窗口"
      >
        <strong style={{ fontSize: 14 }}>AI 解读</strong>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={closeBtn}
        >
          关闭
        </button>
      </div>
      <div style={{ padding: "0 14px 14px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <SessionView
          messages={session.messages}
          streamingId={session.streamingId}
          input={session.input}
          setInput={session.setInput}
          loadingHistory={session.loadingHistory}
          loadingAnswer={session.loadingAnswer}
          sessionReady={sessionReady}
          onSend={session.sendQuestion}
          scrollRef={scrollRef}
          listHeightStyle={{ flex: 1, minHeight: 0, marginBottom: 0 }}
        />
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
