/** 与后端 schemas 对齐的前端类型定义。 */

export interface PaperOut {
  id: number;
  title: string;
  filename: string;
  total_pages: number;
  created_at: string;
  translation_status: string; // pending / running / done / failed
}

export interface PaperDetail extends PaperOut {
  translation_error: string | null;
  translated_at: string | null;
}

export interface PaperListOut {
  total: number;
  items: PaperOut[];
}

export interface TranslationStatusOut {
  paper_id: number;
  status: string; // pending / running / done / failed
  error: string | null;
  // 翻译进度 0-100，仅 status=running 且 pdf2zh 可达时才有值；否则 null
  progress?: number | null;
}

/** 划词正文标记的一个矩形（归一化到该页 viewport，0~1，带页号支持跨页） */
export interface HighlightCoord {
  page: number; // 1-based
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 划词 AI 解读历史记录 */
export interface Highlight {
  id: number;
  paper_id: number;
  variant: "original" | "translated";
  text: string;
  result: string;
  coords: HighlightCoord[];
  created_at: string;
}

/** 新建划词记录的请求体 */
export interface HighlightIn {
  variant: "original" | "translated";
  text: string;
  result: string;
  coords: HighlightCoord[];
}
