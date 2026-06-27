import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import * as pdfjsLib from "pdfjs-dist";

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number; // 1-based
  scale: number;
}

/**
 * 单页渲染：canvas + pdf.js TextLayer（透明可选择文本层）。
 * TextLayer 使内容可划词选择 —— 划词解读功能依赖它。
 * 从 PdfCanvas 抽出，供单页（paged）与连续滚动（scroll）复用。
 */
/** 超采样系数：用 scale×dpr×SS 的高内部分辨率渲染，再让浏览器降采样到显示尺寸，
 * 使矢量文字字边更锐。1=只做正确高清、不超采样（最省）；1.5=均衡（推荐）；2=最锐但最重（像素≈4×）。 */
const SUPERSAMPLE = 1.5;

export default function PdfPage({ doc, pageNumber, scale }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(false);

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
      {/* TextLayer：透明可选择文本，对齐 canvas */}
      <div
        ref={textLayerRef}
        className="textLayer"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          overflow: "hidden",
          opacity: 1,
          lineHeight: 1,
        }}
      />
    </div>
  );
}
