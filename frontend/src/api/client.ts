import type { Highlight, HighlightIn, Message, PaperDetail, PaperListOut, TranslationStatusOut } from "./types";

const BASE = "/api";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** 统一 fetch，自动携带 cookie（httpOnly access_token） */
async function afetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" });
}

export interface UserOut {
  id: number;
  email: string;
  name: string | null;
  created_at: string;
}

export interface LogoutOut {
  detail: string;
  /** Authentik 全局登出地址，非空时前端应整页跳转过去 */
  logout_url: string | null;
}

export interface ProgressOut {
  paper_id: number;
  mode: string;
  page: number;
  scroll_ratio: number;
  has_record: boolean;
}

export const api = {
  // ===== 认证（OIDC 由后端驱动，登录入口为整页跳转 /api/auth/oidc/login）=====
  async logout(): Promise<LogoutOut> {
    const res = await afetch(`${BASE}/auth/logout`, { method: "POST" });
    return jsonOrThrow(res);
  },

  async me(): Promise<UserOut | null> {
    const res = await afetch(`${BASE}/auth/me`);
    if (res.status === 401) return null;
    return jsonOrThrow(res);
  },

  // ===== 论文 =====
  async listPapers(): Promise<PaperListOut> {
    const res = await afetch(`${BASE}/papers`);
    return jsonOrThrow(res);
  },

  async getPaper(id: number): Promise<PaperDetail> {
    const res = await afetch(`${BASE}/papers/${id}`);
    return jsonOrThrow(res);
  },

  async uploadPaper(file: File, onProgress?: (pct: number) => void): Promise<PaperDetail> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/papers`);
      xhr.withCredentials = true; // 携带 cookie
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        try {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(JSON.parse(xhr.responseText).detail || "上传失败"));
          }
        } catch {
          reject(new Error("解析响应失败"));
        }
      };
      xhr.onerror = () => reject(new Error("网络错误"));
      const form = new FormData();
      form.append("file", file);
      xhr.send(form);
    });
  },

  async deletePaper(id: number): Promise<void> {
    const res = await afetch(`${BASE}/papers/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) throw new Error("删除失败");
  },

  paperFileUrl(id: number): string {
    return `${BASE}/papers/${id}/file`;
  },

  /** 译文 PDF（mono，纯中文版面）URL */
  translatedFileUrl(id: number): string {
    return `${BASE}/papers/${id}/translated_file`;
  },

  /** 查询翻译状态 */
  async translationStatus(paperId: number): Promise<TranslationStatusOut> {
    const res = await afetch(`${BASE}/papers/${paperId}/translation-status`);
    return jsonOrThrow(res);
  },

  /** 手动重新触发翻译 */
  async retryTranslate(paperId: number): Promise<TranslationStatusOut> {
    const res = await afetch(`${BASE}/papers/${paperId}/translate`, { method: "POST" });
    return jsonOrThrow(res);
  },

  // ===== 进度 =====
  async getProgress(paperId: number): Promise<ProgressOut> {
    const res = await afetch(`${BASE}/progress/${paperId}`);
    return jsonOrThrow(res);
  },

  async saveProgress(
    paperId: number,
    data: { mode: string; page: number; scroll_ratio: number }
  ): Promise<ProgressOut> {
    const res = await afetch(`${BASE}/progress/${paperId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return jsonOrThrow(res);
  },

  // ===== AI 解读（SSE）=====
  interpretStream(
    text: string,
    context: string | undefined,
    onDelta: (delta: string) => void,
    onError: (msg: string) => void,
    onDone: () => void
  ): AbortController {
    const controller = new AbortController();
    fetch(`${BASE}/interpret`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, context }),
      signal: controller.signal,
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          onError(`请求失败 (${res.status})`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let curEvent = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              curEvent = "";
              continue;
            }
            if (trimmed.startsWith("event:")) {
              curEvent = trimmed.slice(6).trim();
            } else if (trimmed.startsWith("data:")) {
              const raw = trimmed.slice(5).trim();
              let payload = raw;
              try {
                payload = JSON.parse(raw);
              } catch {
                /* 非 JSON 直接用原文 */
              }
              if (curEvent === "delta") onDelta(String(payload));
              else if (curEvent === "error") onError(String(payload));
              else if (curEvent === "done") onDone();
            }
          }
        }
        onDone();
      })
      .catch((e) => {
        if (e?.name !== "AbortError") onError(e?.message || "网络错误");
      });
    return controller;
  },

  // ===== 划词历史 =====
  async listHighlights(paperId: number): Promise<Highlight[]> {
    const res = await afetch(`${BASE}/highlights/${paperId}`);
    return jsonOrThrow(res);
  },

  async createHighlight(paperId: number, data: HighlightIn): Promise<Highlight> {
    const res = await afetch(`${BASE}/highlights/${paperId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return jsonOrThrow(res);
  },

  async deleteHighlight(highlightId: number): Promise<void> {
    const res = await afetch(`${BASE}/highlights/${highlightId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("删除失败");
  },

  /** 载入某会话全部消息（首轮解读 + 追问），按时间升序，用于重建对话上下文 */
  async listMessages(highlightId: number): Promise<Message[]> {
    const res = await afetch(`${BASE}/highlights/${highlightId}/messages`);
    return jsonOrThrow(res);
  },

  /** 追问：SSE 流式，事件协议同 interpretStream（delta/error/done） */
  chatStream(
    highlightId: number,
    question: string,
    onDelta: (delta: string) => void,
    onError: (msg: string) => void,
    onDone: () => void
  ): AbortController {
    const controller = new AbortController();
    fetch(`${BASE}/highlights/${highlightId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      signal: controller.signal,
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          onError(`请求失败 (${res.status})`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let curEvent = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              curEvent = "";
              continue;
            }
            if (trimmed.startsWith("event:")) {
              curEvent = trimmed.slice(6).trim();
            } else if (trimmed.startsWith("data:")) {
              const raw = trimmed.slice(5).trim();
              let payload = raw;
              try {
                payload = JSON.parse(raw);
              } catch {
                /* 非 JSON 直接用原文 */
              }
              if (curEvent === "delta") onDelta(String(payload));
              else if (curEvent === "error") onError(String(payload));
              else if (curEvent === "done") onDone();
            }
          }
        }
        onDone();
      })
      .catch((e) => {
        if (e?.name !== "AbortError") onError(e?.message || "网络错误");
      });
    return controller;
  },
};
