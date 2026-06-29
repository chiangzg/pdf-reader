import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import * as pdfjsLib from "pdfjs-dist";
import type { Highlight } from "../api/types";

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number; // 1-based
  scale: number;
  /** 本页所属侧：原文 / 译文（bilingual 下左右两侧不同） */
  variant: "original" | "translated";
  /** 全量划词记录，组件内按 variant + page 过滤 */
  highlights?: Highlight[];
  /** 抽屉当前悬停项 id，命中时该记录下划线加深 */
  hoveredId?: number | null;
  /** 点击某条下划线（可选） */
  onHighlightClick?: (h: Highlight) => void;
}

/**
 * 单页渲染：canvas + pdf.js TextLayer（透明可选择文本层）。
 * TextLayer 使内容可划词选择 —— 划词解读功能依赖它。
 * 从 PdfCanvas 抽出，供单页（paged）与连续滚动（scroll）复用。
 *
 * 另有一个独立于 textLayer 的「高亮叠加层」：textLayer 容器带 data-pdf-page /
 * data-pdf-variant 属性供 useSelection 读取页码与侧别；叠加层只依赖 displayVp
 * 尺寸 + 归一化坐标，因此 pdf.js 翻页重建 textLayer、scale 变化、paged↔scroll
 * 切换都不会导致标记错位。
 */
/** 超采样系数：用 scale×dpr×SS 的高内部分辨率渲染，再让浏览器降采样到显示尺寸，
 * 使矢量文字字边更锐。1=只做正确高清、不超采样（最省）；1.5=均衡（推荐）；2=最锐但最重（像素≈4×）。 */
const SUPERSAMPLE = 1.5;

export default function PdfPage({ doc, pageNumber, scale, variant, highlights = [], hoveredId = null, onHighlightClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(false);
  // 记录该页显示尺寸（CSS px），供叠加层定位
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!canvasRef.current || !textLayerRef.current) return;
      setRendering(true);
      try {
        const pdfPage = await doc.getPage(pageNumber);
        if (cancelled) return;

        // 高清渲染：把 dpr + 超采样折进 viewport 的 scale，让 pdf.js 直接在高物理
        // 分辨率下光栅化矢量内容，而非"画小图再矩阵拉伸放大"（后者正是字发虚的根因）。
        // canvas 用放大尺寸（物理像素），CSS 尺寸保持显示尺寸，浏览器自然降采样。
        const dpr = window.devicePixelRatio || 1;
        const displayVp = pdfPage.getViewport({ scale });
        const renderVp = pdfPage.getViewport({ scale: scale * dpr * SUPERSAMPLE });

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = renderVp.width;
        canvas.height = renderVp.height;
        canvas.style.width = `${displayVp.width}px`;
        canvas.style.height = `${displayVp.height}px`;
        // 不再 setTransform —— renderVp 已含放大倍率，pdf.js 据此 1:1 高清绘制
        await pdfPage.render({ canvasContext: ctx, viewport: renderVp }).promise;
        if (cancelled) return;

        // TextLayer（透明可选择文本层，对齐到显示盒，划词不受超采样影响）
        const textLayer = textLayerRef.current;
        textLayer.innerHTML = "";
        textLayer.style.width = `${displayVp.width}px`;
        textLayer.style.height = `${displayVp.height}px`;
        const textContent = await pdfPage.getTextContent();
        if (cancelled) return;
        const PdfLibAny = pdfjsLib as unknown as {
          TextLayer: new (opts: {
            textContentSource: Awaited<ReturnType<typeof pdfPage.getTextContent>>;
            container: HTMLElement;
            viewport: typeof displayVp;
          }) => { render: () => Promise<void> };
        };
        const tl = new PdfLibAny.TextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport: displayVp,
        });
        await tl.render();
        if (!cancelled) setDisplaySize({ w: displayVp.width, h: displayVp.height });
      } catch (e) {
        console.error("渲染页面失败", e);
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, scale]);

  // 本页相关的高亮矩形（variant 匹配 + 本页坐标）
  const pageRects: { h: Highlight; x: number; y: number; w: number; height: number }[] = [];
  if (displaySize) {
    for (const h of highlights) {
      if (h.variant !== variant) continue;
      for (const c of h.coords) {
        if (c.page !== pageNumber) continue;
        pageRects.push({
          h,
          x: c.x * displaySize.w,
          y: c.y * displaySize.h,
          w: c.w * displaySize.w,
          height: c.h * displaySize.h,
        });
      }
    }
  }

  return (
    <div style={{ position: "relative", display: "inline-block", background: "#fff" }}>
      <canvas ref={canvasRef} style={{ display: "block", boxShadow: "0 1px 8px rgba(0,0,0,.15)" }} />
      {rendering && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,.5)",
            color: "var(--muted)",
          }}
        >
          渲染中…
        </div>
      )}
      {/* TextLayer：透明可选择文本，对齐 canvas。带 data 属性供划词捕获读取页码/侧别 */}
      <div
        ref={textLayerRef}
        className="textLayer"
        data-pdf-page={pageNumber}
        data-pdf-variant={variant}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          overflow: "hidden",
          opacity: 1,
          lineHeight: 1,
        }}
      />
      {/* 高亮叠加层：独立于 textLayer，只依赖 displaySize + 归一化坐标 */}
      {displaySize && pageRects.length > 0 && (
        <div
          className="highlight-layer"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: displaySize.w,
            height: displaySize.h,
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          {pageRects.map((r, i) => {
            const active = hoveredId === r.h.id;
            return (
              <div
                key={`${r.h.id}-${i}`}
                onClick={onHighlightClick ? (e) => { e.stopPropagation(); onHighlightClick(r.h); } : undefined}
                style={{
                  position: "absolute",
                  left: r.x,
                  top: r.y + r.height - 2, // 贴行底画下划线
                  width: r.w,
                  height: active ? 3 : 2,
                  background: active ? "rgba(37,99,235,0.85)" : "rgba(245,158,11,0.55)",
                  borderRadius: 1,
                  cursor: onHighlightClick ? "pointer" : "default",
                  pointerEvents: onHighlightClick ? "auto" : "none",
                  transition: "background .12s, height .12s",
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
