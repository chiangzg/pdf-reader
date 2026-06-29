import { useEffect, useMemo, useRef, useState } from "react";
import { useDevice } from "../hooks/useDevice";
import type { Highlight } from "../api/types";
import { matchHighlight } from "../utils/similarity";
import type { SelectionState } from "../hooks/useSelection";

interface Props {
  /** 选区；null 时不显示 */
  selection: SelectionState | null;
  /** 全量历史会话（用于智能识别续接候选） */
  highlights: Highlight[];
  /** 新建解读：触发首轮 SSE 流 */
  onInterpret: (text: string, rect: DOMRect) => void;
  /** 续接既有会话：载入历史消息进入会话模式 */
  onResume: (highlightId: number) => void;
}

/**
 * 划词浮窗快捷条：选区附近的浮动工具条。
 * - PC：mouseup 后紧贴选区上方/下方
 * - 移动端：手柄稳定后出现，触控目标 ≥44px，预留手柄避让区
 *
 * 智能识别（续接优先）：划词后纯前端内存计算匹配既有会话：
 *  - 精确匹配：主按钮「⟳ 继续上次对话」，次按钮「✨ 新建解读」
 *  - 软匹配：主按钮「✨ 新建解读」，次按钮「⟳ 看似解读过?」
 *  - 无匹配：仅「✨ 新建解读」（当前行为）
 * 候选必须同 variant + 命中同页（坐标无法跨页/跨侧）。
 */
export default function SelectionToolbar({ selection, highlights, onInterpret, onResume }: Props) {
  const { isTouch } = useDevice();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const rect = selection?.rect ?? null;

  // 智能识别：在候选会话中找最佳匹配
  const best = useMemo(() => {
    if (!selection) return null;
    let bestH: Highlight | null = null;
    let bestScore = 0;
    for (const h of highlights) {
      if (h.variant !== selection.variant) continue;
      // 候选须命中同一页（坐标无法跨页）
      if (!h.coords.some((c) => c.page === selection.page)) continue;
      const r = matchHighlight(selection.text, selection.normRects, h.text, h.coords);
      if (r.score > bestScore) {
        bestScore = r.score;
        bestH = h;
      }
    }
    if (!bestH) return null;
    const exact = bestScore >= 0.95; // 归一化精确匹配综合分接近 1
    const soft = !exact && bestScore >= 0.85;
    if (!exact && !soft) return null; // 无有效匹配
    return { highlight: bestH, exact, soft, score: bestScore };
  }, [selection, highlights]);

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
  }, [rect, isTouch, best]);

  if (!rect || !pos || !selection) return null;

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // 续接优先：精确匹配时主按钮=继续，次按钮=新建；软匹配时主按钮=新建，次按钮=继续
  const resumePrimary = best?.exact === true;
  const showResume = best != null;
  const showNew = !resumePrimary; // 精确匹配时次按钮才有"新建"

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
      {/* 续接按钮：精确匹配时为主操作，软匹配时为次操作 */}
      {showResume && (
        <button
          onMouseDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            if (best) onResume(best.highlight.id);
          }}
          style={{
            ...btnStyle,
            background: resumePrimary ? "var(--primary)" : "transparent",
            color: resumePrimary ? "#fff" : "rgba(255,255,255,0.85)",
            border: resumePrimary ? "none" : "1px solid rgba(255,255,255,0.3)",
            minHeight: isTouch ? 44 : 32,
            minWidth: isTouch ? 44 : 32,
            padding: isTouch ? "0 14px" : "4px 12px",
          }}
        >
          {best?.soft ? "⟳ 看似解读过?" : "⟳ 继续上次对话"}
        </button>
      )}
      {/* 新建按钮：无匹配时为唯一主操作；精确匹配时隐藏（已续接）；软匹配时为主操作 */}
      {showNew && (
        <button
          onMouseDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            onInterpret(selection.text, rect);
          }}
          style={{
            ...btnStyle,
            minHeight: isTouch ? 44 : 32,
            minWidth: isTouch ? 44 : 32,
            padding: isTouch ? "0 14px" : "4px 12px",
          }}
        >
          ✨ 新建解读
        </button>
      )}
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
