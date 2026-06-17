import { useCallback, useEffect, useRef, useState } from "react";
import { useDevice } from "./useDevice";

export interface SelectionState {
  text: string;
  rect: DOMRect; // 选区在视口的位置（用于浮窗定位）
}

/**
 * 统一选区监听（PC 鼠标拖选 / 移动端长按选区）。
 *
 * PC：mouseup 后立即捕获选区。
 * 移动端：selectionchange 在拖拽手柄时频繁触发，需 debounce 等其稳定；
 *         且需排除过短选区（误触）。
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

    setSelection({ text, rect });
    onTextSelected?.({ text, rect });
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
