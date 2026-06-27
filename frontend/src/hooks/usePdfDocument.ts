import { useEffect, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// worker：与 pdfjs-dist 版本匹配的 worker URL
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface PdfDocumentState {
  doc: pdfjsLib.PDFDocumentProxy | null;
  numPages: number;
  loading: boolean;
  error: string | null;
}

/**
 * 共享 PDF 文档加载：同一个 fileUrl 只 getDocument 一次，
 * 供连续滚动（PdfScroll）与单页（PdfCanvas）复用，避免 N 次重复加载。
 */
export function usePdfDocument(fileUrl: string): PdfDocumentState {
  const [state, setState] = useState<PdfDocumentState>({
    doc: null,
    numPages: 0,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ doc: null, numPages: 0, loading: true, error: null });
    const loadingTask = pdfjsLib.getDocument(fileUrl);
    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        setState({ doc, numPages: doc.numPages, loading: false, error: null });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({
          doc: null,
          numPages: 0,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [fileUrl]);

  return state;
}

/**
 * 测量每页在「scale=1」下的原始尺寸（每 doc 只测一次，pdf.js 内部有缓存）。
 * 调用方按需 ×scale 即可得到任意缩放尺寸 —— 用于 PdfScroll 预占位与渲染。
 */
export function useBasePageSizes(
  doc: pdfjsLib.PDFDocumentProxy | null,
  numPages: number
): Array<{ width: number; height: number } | null> {
  const [base, setBase] = useState<Array<{ width: number; height: number } | null>>(() =>
    new Array(numPages).fill(null)
  );

  useEffect(() => {
    if (!doc) {
      setBase(new Array(numPages).fill(null));
      return;
    }
    let cancelled = false;

    (async () => {
      for (let i = 1; i <= numPages; i++) {
        if (cancelled) return;
        try {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const vp = page.getViewport({ scale: 1 });
          const sz = { width: vp.width, height: vp.height };
          setBase((prev) => {
            const next = prev.slice();
            next[i - 1] = sz;
            return next;
          });
        } catch {
          if (cancelled) return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, numPages]);

  return base;
}
