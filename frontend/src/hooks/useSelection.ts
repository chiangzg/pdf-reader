import { useCallback, useEffect, useRef, useState } from "react";
import { useDevice } from "./useDevice";
import type { HighlightCoord } from "../api/types";

/** 一个划词选区的归一化矩形（相对其所在页 viewport） */
export interface NormRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SelectionState {
  text: string;
  rect: DOMRect; // 选区在视口的位置（用于浮窗定位）
  /** 划词所在页（1-based），来自 textLayer 容器的 data-pdf-page */
  page: number;
  /** 划词所在侧：原文 / 译文（来自 data-pdf-variant） */
  variant: "original" | "translated";
  /** 归一化到该页 viewport 的矩形数组（每行一个小矩形，跨行精确） */
  normRects: NormRect[];
}

/**
 * 统一选区监听（PC 鼠标拖选 / 移动端长按选区）。
 *
 * PC：mouseup 后立即捕获选区。
 * 移动端：selectionchange 在拖拽手柄时频繁触发，需 debounce 等其稳定；
 *         且需排除过短选区（误触）。
 *
 * 选区页码与侧别（page/variant）通过 textLayer 容器上的
 *   data-pdf-page / data-pdf-variant 属性自取，无需调用方透传回调。
 *
 * @param rootRef 限定选区来源的根元素（阅读器内容区），null 表示全局
 */
export function useSelection(
  rootRef: React.RefObject<HTMLElement | null>,
  onTextSelected?: (s: SelectionState) => void,
  onCleared?: () => void
) {
  const { isTouch } = useDevice();
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const capture = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelection(null);
      onCleared?.();
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 2) {
      // 过短视为无选区（避免点击误触发）
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    // 限定来源：选区必须在根元素内
    if (rootRef?.current) {
      const rootRect = rootRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const inside =
        cx >= rootRect.left &&
        cx <= rootRect.right &&
        cy >= rootRect.top &&
        cy <= rootRect.bottom;
      if (!inside) return;
    }

    // 从选区起点向上找 textLayer 容器，读取 page / variant
    let container: HTMLElement | null = null;
    try {
      const startNode = range.startContainer;
      container =
        startNode.nodeType === Node.ELEMENT_NODE
          ? (startNode as HTMLElement).closest("[data-pdf-page]")
          : startNode.parentElement?.closest("[data-pdf-page]") ?? null;
    } catch {
      container = null;
    }
    if (!container) return; // 非正文选区，忽略
    const page = Number(container.getAttribute("data-pdf-page"));
    const variantAttr = container.getAttribute("data-pdf-variant");
    const variant: "original" | "translated" =
      variantAttr === "translated" ? "translated" : "original";
    if (!page) return;

    // 归一化：以该 textLayer 容器尺寸为分母，range.getClientRects() 取每行小矩形
    const pageRect = container.getBoundingClientRect();
    const normRects: NormRect[] = [];
    if (pageRect.width > 0 && pageRect.height > 0) {
      const lineRects = range.getClientRects();
      for (let i = 0; i < lineRects.length; i++) {
        const r = lineRects[i];
        const x = (r.left - pageRect.left) / pageRect.width;
        const y = (r.top - pageRect.top) / pageRect.height;
        const w = r.width / pageRect.width;
        const h = r.height / pageRect.height;
        if (w > 0 && h > 0) {
          normRects.push({
            page,
            x: Math.max(0, Math.min(1, x)),
            y: Math.max(0, Math.min(1, y)),
            w: Math.max(0, Math.min(1, w)),
            h: Math.max(0, Math.min(1, h)),
          });
        }
      }
    }
    if (normRects.length === 0) return;

    setSelection({ text, rect, page, variant, normRects });
    onTextSelected?.({ text, rect, page, variant, normRects });
  }, [rootRef, onTextSelected, onCleared]);

  useEffect(() => {
    if (isTouch) {
      // 移动端：selectionchange debounce，等手柄拖拽稳定
      const handler = () => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(capture, 350);
      };
      document.addEventListener("selectionchange", handler);
      return () => {
        document.removeEventListener("selectionchange", handler);
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
      };
    }
    // PC：mouseup 捕获
    const handler = () => {
      // 微延迟，确保 selection 已更新
      setTimeout(capture, 10);
    };
    document.addEventListener("mouseup", handler);
    return () => document.removeEventListener("mouseup", handler);
  }, [isTouch, capture]);

  const clear = useCallback(() => {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    setSelection(null);
    onCleared?.();
  }, [onCleared]);

  return { selection, clear };
}

/** 把 NormRect 转成持久化用的高亮坐标（同构） */
export function toHighlightCoords(normRects: NormRect[]): HighlightCoord[] {
  return normRects.map((r) => ({ page: r.page, x: r.x, y: r.y, w: r.w, h: r.h }));
}
