/** 与后端 schemas 对齐的前端类型定义。 */

export interface PaperOut {
  id: number;
  title: string;
  filename: string;
  source_hash: string;
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

/** 解读会话头（Highlight 即会话，解读内容存在 Message 表里） */
export interface Highlight {
  id: number;
  paper_id: number;
  variant: "original" | "translated";
  text: string; // 划词原文（会话主题）
  coords: HighlightCoord[];
  created_at: string;
  message_count: number; // 会话消息数（含首轮 + 追问）
  preview: string; // 末条 assistant 预览（截断），供抽屉扫读
}

/** 新建会话的请求体：建会话头 + 首条 assistant 消息（组合接口） */
export interface HighlightIn {
  variant: "original" | "translated";
  text: string;
  coords: HighlightCoord[];
  /** 首轮解读全文（落为首条 assistant 消息） */
  result: string;
}

/** 会话中的一条消息（首轮解读或追问） */
export interface Message {
  id: number;
  highlight_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}
