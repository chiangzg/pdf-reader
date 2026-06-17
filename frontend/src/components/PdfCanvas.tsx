import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
// worker：与 pdfjs-dist 版本匹配的 worker URL
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface Props {
  fileUrl: string;
  page: number; // 1-based
  scale: number;
  /** 渲染出页面尺寸后回调 */
  onViewport?: (vp: { width: number; height: number }) => void;
}

/**
 * PDF 渲染组件：canvas 渲染页面 + pdf.js TextLayer（透明可选择文本层）。
 * TextLayer 使内容可划词选择 —— 划词解读功能依赖它，两种模式都使用本组件。
 */
export default function PdfCanvas({ fileUrl, page, scale, onViewport }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const [rendering, setRendering] = useState(false);

  // 加载 PDF 文档
  useEffect(() => {
    let cancelled = false;
    const loadingTask = pdfjsLib.getDocument(fileUrl);
    loadingTask.promise.then((doc) => {
      if (!cancelled) setPdfDoc(doc);
    });
    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [fileUrl]);

  // 渲染当前页：canvas + TextLayer
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current || !textLayerRef.current) return;
    setRendering(true);
    try {
      const pdfPage = await pdfDoc.getPage(page);
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

      // TextLayer（透明可选择文本层，对齐 canvas）
      const textLayer = textLayerRef.current;
      textLayer.innerHTML = "";
      textLayer.style.width = `${vp.width}px`;
      textLayer.style.height = `${vp.height}px`;
      const textContent = await pdfPage.getTextContent();
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
      const nextVp = { width: vp.width, height: vp.height };
      setViewport(nextVp);
      onViewport?.(nextVp);
    } catch (e) {
      console.error("渲染页面失败", e);
    } finally {
      setRendering(false);
    }
  }, [pdfDoc, page, scale, onViewport]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block", background: "#fff" }}>
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
      {/* viewport 占位以避免未使用告警 */}
      {viewport ? null : null}
    </div>
  );
}
