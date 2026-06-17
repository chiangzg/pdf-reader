import { useEffect, useRef, useState } from "react";
import { useDevice } from "../hooks/useDevice";

interface Props {
  /** 选区 rect；null 时不显示 */
  rect: DOMRect | null;
  /** 选中的文本（点击按钮时一并传出，避免依赖外部 state 时序） */
  text: string | null;
  onInterpret: (text: string, rect: DOMRect) => void;
}

/**
 * 划词浮窗快捷条：选区附近的浮动工具条。
 * - PC：mouseup 后紧贴选区上方/下方
 * - 移动端：手柄稳定后出现，触控目标 ≥44px，预留手柄避让区
 *
 * v1 只有一个功能：AI 解读。按钮列表可扩展。
 */
export default function SelectionToolbar({ rect, text, onInterpret }: Props) {
  const { isTouch } = useDevice();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rect) {
      setPos(null);
      return;
    }
    // 等待 DOM 渲染后测量自身尺寸
    requestAnimationFrame(() => {
      const bar = barRef.current;
      const barW = bar?.offsetWidth ?? 130;
      const barH = bar?.offsetHeight ?? 40;
      const handleGap = isTouch ? 40 : 8; // 移动端预留选择手柄高度避让
      const vh = window.innerHeight;

      // 锚点用选区顶部（首行位置），避免跨多行时 rect.bottom 过大导致浮窗跑到视口外
      const anchorTop = rect.top;
      const anchorBottom = Math.min(rect.bottom, rect.top + 40); // 限制锚底，避免大选区

      const center = rect.left + rect.width / 2;
      let left = center - barW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - barW - 8));

      // 优先放选区上方；上方空间不足则放下方；都不足则贴视口顶部
      let top: number;
      const aboveTop = anchorTop - barH - handleGap;
      const belowTop = anchorBottom + handleGap;
      if (aboveTop > 8) {
        top = aboveTop;
      } else if (belowTop + barH < vh - 8) {
        top = belowTop;
      } else {
        top = 8; // 兜底贴顶
      }
      setPos({ left, top });
    });
  }, [rect, isTouch]);

  if (!rect || !pos) return null;

  return (
    <div
      ref={barRef}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        zIndex: 999,
        display: "flex",
        gap: 6,
        padding: isTouch ? "6px 8px" : "4px 6px",
        background: "#1f2329",
        borderRadius: 10,
        boxShadow: "0 6px 20px rgba(0,0,0,.25)",
        animation: "popIn .12s",
      }}
      // 阻止事件冒泡，防止点击触发 useSelection 的 mouseup 监听导致选区判定异常
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (text && rect) onInterpret(text, rect);
        }}
        style={{
          ...btnStyle,
          minHeight: isTouch ? 44 : 32,
          minWidth: isTouch ? 44 : 32,
          padding: isTouch ? "0 14px" : "4px 12px",
        }}
      >
        ✨ AI 解读
      </button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
