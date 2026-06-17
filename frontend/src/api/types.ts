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
