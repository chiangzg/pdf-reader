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
        const vp = pdfPage.getViewport({ scale });

        // canvas
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = vp.width * dpr;
        canvas.height = vp.height * dpr;
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
        if (cancelled) return;

        // TextLayer（透明可选择文本层，对齐 canvas）
        const textLayer = textLayerRef.current;
        textLayer.innerHTML = "";
        textLayer.style.width = `${vp.width}px`;
        textLayer.style.height = `${vp.height}px`;
        const textContent = await pdfPage.getTextContent();
        if (cancelled) return;
        const PdfLibAny = pdfjsLib as unknown as {
          TextLayer: new (opts: {
            textContentSource: Awaited<ReturnType<typeof pdfPage.getTextContent>>;
            container: HTMLElement;
            viewport: typeof vp;
          }) => { render: () => Promise<void> };
        };
        const tl = new PdfLibAny.TextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport: vp,
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
