import PdfPage from "./PdfPage";
import { usePdfDocument } from "../hooks/usePdfDocument";
import type { Highlight } from "../api/types";

interface Props {
  fileUrl: string;
  page: number; // 1-based
  scale: number;
  /** 本 PDF 所属侧：原文 / 译文（bilingual 下决定划词 variant） */
  variant?: "original" | "translated";
  highlights?: Highlight[];
  hoveredId?: number | null;
  onHighlightClick?: (h: Highlight) => void;
}

/**
 * 单页渲染壳（paged 模式用）：自行加载文档 + 渲染单页。
 * 实际渲染逻辑见 PdfPage；本组件负责文档生命周期与加载态。
 */
export default function PdfCanvas({ fileUrl, page, scale, variant = "original", highlights, hoveredId, onHighlightClick }: Props) {
  const { doc, loading, error } = usePdfDocument(fileUrl);

  if (loading) {
    return (
      <div
        style={{
          width: 420,
          height: 560,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          background: "#fff",
          boxShadow: "0 1px 8px rgba(0,0,0,.15)",
        }}
      >
        加载中…
      </div>
    );
  }
  if (error || !doc) {
    return (
      <div
        style={{
          width: 420,
          height: 560,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#dc2626",
          background: "#fff",
          boxShadow: "0 1px 8px rgba(0,0,0,.15)",
        }}
      >
        {error || "加载失败"}
      </div>
    );
  }

  return (
    <PdfPage
      doc={doc}
      pageNumber={page}
      scale={scale}
      variant={variant}
      highlights={highlights}
      hoveredId={hoveredId}
      onHighlightClick={onHighlightClick}
    />
  );
}
