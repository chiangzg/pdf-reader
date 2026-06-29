import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import PdfPage from "./PdfPage";
import { useBasePageSizes, usePdfDocument } from "../hooks/usePdfDocument";
import type { Highlight } from "../api/types";

export interface PdfScrollHandle {
  scrollToPage: (n: number) => void;
  getScrollRatio: () => number;
  setScrollRatio: (r: number) => void;
}

interface Props {
  fileUrl: string;
  scale: number;
  gap?: number;
  /** 初始页（1-based），首次测量到尺寸后滚动定位 */
  initialPage?: number;
  onPageChange?: (page: number) => void;
  /** 用户（非程序）滚动时回调当前滚动比例，用于双语两列联动 */
  onUserScrollRatio?: (ratio: number) => void;
  /** 本 PDF 所属侧：原文 / 译文 */
  variant?: "original" | "translated";
  highlights?: Highlight[];
  hoveredId?: number | null;
  onHighlightClick?: (h: Highlight) => void;
}

/** 视口上下各多渲染这么多 px，避免快速滚动时出现空白 */
const RENDER_MARGIN = 1200;
/** 未测量前的默认页面尺寸（A4 / Letter 量级，pt） */
const EST_SIZE = { width: 612, height: 792 };

/**
 * 连续滚动渲染器：所有页纵向堆叠，浏览器原生滚动（滚轮/触控板，每次滚动几个单位）。
 * - 用每页 viewport 尺寸预占位（滚动条高度准确）；
 * - 只对视口附近页挂载 PdfPage（IntersectionWindow），远处用占位，防内存爆炸；
 * - 跟踪「最居中可见页」→ onPageChange，驱动工具栏页码与进度；
 * - 暴露 scrollToPage / getScrollRatio / setScrollRatio（恢复 + 键盘 + 双语联动）。
 */
const PdfScroll = forwardRef<PdfScrollHandle, Props>(function PdfScroll(
  { fileUrl, scale, gap = 16, initialPage = 1, onPageChange, onUserScrollRatio, variant = "original", highlights, hoveredId, onHighlightClick },
  ref
) {
  const { doc, numPages, loading, error } = usePdfDocument(fileUrl);
  const baseSizes = useBasePageSizes(doc, numPages);

  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleSetRef = useRef<Set<number>>(new Set());
  const [, bump] = useState(0);
  const isProgrammatic = useRef(false);
  const progTimer = useRef<number | null>(null);
  const restoredRef = useRef(false);
  const currentPageRef = useRef(1);
  const rafRef = useRef<number | null>(null);

  /** 某页（0-based idx）按当前 scale 的尺寸；未测量则用估算 */
  const sizedAt = useCallback(
    (idx: number) => {
      const b = baseSizes[idx];
      const w = (b?.width ?? EST_SIZE.width) * scale;
      const h = (b?.height ?? EST_SIZE.height) * scale;
      return { width: w, height: h };
    },
    [baseSizes, scale]
  );

  /** 程序化滚动标记：期间忽略自身滚动回调，避免双语联动回环 */
  const beginProgrammatic = useCallback(() => {
    isProgrammatic.current = true;
    if (progTimer.current) window.clearTimeout(progTimer.current);
    progTimer.current = window.setTimeout(() => {
      isProgrammatic.current = false;
    }, 250);
  }, []);

  /** 重算视口附近应渲染的页集合 */
  const recomputeVisible = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !numPages) return;
    const top = el.scrollTop - RENDER_MARGIN;
    const bottom = el.scrollTop + el.clientHeight + RENDER_MARGIN;
    // 列顶部有 gap 内边距，所有页偏移以此为起点
    let acc = gap;
    const next = new Set<number>();
    for (let i = 0; i < numPages; i++) {
      const sz = sizedAt(i);
      const pageTop = acc;
      const pageBottom = acc + sz.height;
      acc = pageBottom + gap;
      if (pageBottom >= top && pageTop <= bottom) next.add(i + 1);
    }
    const cur = visibleSetRef.current;
    let changed = cur.size !== next.size;
    if (!changed) for (const p of next) if (!cur.has(p)) { changed = true; break; }
    if (changed) {
      visibleSetRef.current = next;
      bump((x) => x + 1);
    }
  }, [numPages, gap, sizedAt]);

  /** 跟踪当前页（视口垂直中心所在页） */
  const recomputeCurrentPage = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !numPages) return;
    const center = el.scrollTop + el.clientHeight / 2;
    let acc = gap;
    let cur = 1;
    for (let i = 0; i < numPages; i++) {
      const sz = sizedAt(i);
      const pageTop = acc;
      const pageBottom = acc + sz.height;
      if (center >= pageTop && center < pageBottom) { cur = i + 1; break; }
      acc = pageBottom + gap;
      cur = i + 1;
    }
    if (cur !== currentPageRef.current) {
      currentPageRef.current = cur;
      onPageChange?.(cur);
    }
  }, [numPages, gap, sizedAt, onPageChange]);

  /** 滚到指定页顶部（1-based） */
  const scrollToPageImpl = useCallback(
    (n: number, programmatic = true) => {
      const el = scrollRef.current;
      if (!el || !numPages) return;
      const idx = Math.max(1, Math.min(numPages, n)) - 1;
      // 列顶部 gap 内边距 + 之前各页高度与间距
      let acc = gap;
      for (let i = 0; i < idx; i++) acc += sizedAt(i).height + gap;
      if (programmatic) beginProgrammatic();
      el.scrollTo({ top: acc, behavior: "auto" });
      recomputeVisible();
      recomputeCurrentPage();
    },
    [numPages, gap, sizedAt, beginProgrammatic, recomputeVisible, recomputeCurrentPage]
  );

  // 滚动事件：用户滚动时更新可见窗口 + 当前页 + 联动比例
  const handleScroll = useCallback(() => {
    if (isProgrammatic.current) return;
    recomputeVisible();
    recomputeCurrentPage();
    const el = scrollRef.current;
    if (el && onUserScrollRatio) {
      // rAF 节流联动
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const e = scrollRef.current;
          if (!e) return;
          const m = e.scrollHeight - e.clientHeight;
          onUserScrollRatio(m > 0 ? e.scrollTop / m : 0);
        });
      }
    }
  }, [recomputeVisible, recomputeCurrentPage, onUserScrollRatio]);

  // 尺寸就绪后：渲染窗口 + 首次恢复到 initialPage
  useEffect(() => {
    recomputeVisible();
    recomputeCurrentPage();
    if (!restoredRef.current && baseSizes.some(Boolean) && numPages) {
      restoredRef.current = true;
      // 等下一帧布局稳定再定位
      requestAnimationFrame(() => scrollToPageImpl(initialPage, true));
    }
  }, [baseSizes, numPages, scale, initialPage, recomputeVisible, recomputeCurrentPage, scrollToPageImpl]);

  // scale 变化：保持当前页在视口顶部，避免跳动
  const prevScaleRef = useRef(scale);
  useEffect(() => {
    if (prevScaleRef.current === scale) return;
    prevScaleRef.current = scale;
    scrollToPageImpl(currentPageRef.current, false);
  }, [scale, scrollToPageImpl]);

  // 暴露命令
  useImperativeHandle(
    ref,
    () => ({
      scrollToPage: (n: number) => scrollToPageImpl(n, true),
      getScrollRatio: () => {
        const el = scrollRef.current;
        if (!el) return 0;
        const max = el.scrollHeight - el.clientHeight;
        return max > 0 ? el.scrollTop / max : 0;
      },
      setScrollRatio: (r: number) => {
        const el = scrollRef.current;
        if (!el) return;
        const max = el.scrollHeight - el.clientHeight;
        beginProgrammatic();
        el.scrollTo({ top: max * Math.max(0, Math.min(1, r)), behavior: "auto" });
      },
    }),
    [scrollToPageImpl, beginProgrammatic]
  );

  useEffect(() => {
    return () => {
      if (progTimer.current) window.clearTimeout(progTimer.current);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (loading) return <Placeholder text="加载中…" />;
  if (error) return <Placeholder text={error} color="#dc2626" />;
  if (!doc) return null;

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      style={{ height: "100%", overflowY: "auto", overflowX: "hidden", paddingBottom: gap }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap, paddingTop: gap }}>
        {Array.from({ length: numPages }, (_, i) => {
          const pageNo = i + 1;
          const sz = sizedAt(i);
          const visible = visibleSetRef.current.has(pageNo);
          return (
            <div
              key={pageNo}
              style={{
                width: sz.width,
                height: sz.height,
                flex: "0 0 auto",
                display: "flex",
                justifyContent: "center",
                background: "#fff",
                boxShadow: "0 1px 8px rgba(0,0,0,.15)",
              }}
            >
              {visible ? (
                <PdfPage
                  doc={doc}
                  pageNumber={pageNo}
                  scale={scale}
                  variant={variant}
                  highlights={highlights}
                  hoveredId={hoveredId}
                  onHighlightClick={onHighlightClick}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default PdfScroll;

function Placeholder({ text, color }: { text: string; color?: string }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: color ?? "var(--muted)",
      }}
    >
      {text}
    </div>
  );
}
