import { useRef } from "react";
import { useDevice } from "../hooks/useDevice";
import PdfCanvas from "./PdfCanvas";
import TranslationPane from "./TranslationPane";
import PdfScroll, { type PdfScrollHandle } from "./PdfScroll";
import type { Highlight } from "../api/types";

interface Props {
  fileUrl: string; // 原始 PDF（英文）
  translatedFileUrl: string; // 译文 PDF（mono，纯中文版面）
  translationStatus: string; // pending / running / done / failed
  translationError?: string | null;
  translationProgress?: number | null; // 0-100，running 时有值；null=暂未上报
  page: number; // 当前页（1-based，与原版面模式共享）
  scale: number;
  pageMode: "paged" | "scroll";
  onPageChange?: (page: number) => void;
  highlights?: Highlight[];
  hoveredId?: number | null;
  onHighlightClick?: (h: Highlight) => void;
}

/**
 * 双语对照：左原始 PDF（英文），右译文 PDF（中文）。
 * - paged：PC 左右并排单页，移动端上下叠放；
 * - scroll：左右两列各自连续滚动并按滚动比例联动（节流 + 防回环）。
 * 翻译未完成时右栏显示进度占位（TranslationPane 内部处理）。
 */
export default function BilingualView({
  fileUrl,
  translatedFileUrl,
  translationStatus,
  translationError,
  translationProgress,
  page,
  scale,
  pageMode,
  onPageChange,
  highlights,
  hoveredId,
  onHighlightClick,
}: Props) {
  const { isMobile } = useDevice();
  const translatedReady = translationStatus === "done";

  // ===== scroll 模式：两列联动 =====
  const leftRef = useRef<PdfScrollHandle>(null);
  const rightRef = useRef<PdfScrollHandle>(null);
  // 哪一列是「主导」（最近一次用户滚动来源），用 ratio 同步另一列
  const syncingRef = useRef(false);

  if (pageMode === "scroll") {
    // 译文未就绪：右栏回退为进度占位，左栏单独滚动
    return (
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 12 : 16,
          height: "100%",
        }}
      >
        <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
          <PdfScroll
            ref={leftRef}
            fileUrl={fileUrl}
            scale={scale}
            initialPage={page}
            onPageChange={onPageChange}
            variant="original"
            highlights={highlights}
            hoveredId={hoveredId}
            onHighlightClick={onHighlightClick}
            onUserScrollRatio={(r) => {
              if (syncingRef.current || !translatedReady) return;
              syncingRef.current = true;
              rightRef.current?.setScrollRatio(r);
              syncingRef.current = false;
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
          {translatedReady ? (
            <PdfScroll
              ref={rightRef}
              fileUrl={translatedFileUrl}
              scale={scale}
              initialPage={page}
              variant="translated"
              highlights={highlights}
              hoveredId={hoveredId}
              onHighlightClick={onHighlightClick}
              onPageChange={() => {
                /* 双语下以左栏页码为准，右栏不覆盖 */
              }}
              onUserScrollRatio={(r) => {
                if (syncingRef.current) return;
                syncingRef.current = true;
                leftRef.current?.setScrollRatio(r);
                syncingRef.current = false;
              }}
            />
          ) : (
            <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
              <TranslationPane
                translatedFileUrl={translatedFileUrl}
                translationStatus={translationStatus}
                translationError={translationError}
                translationProgress={translationProgress}
                page={page}
                scale={scale}
                highlights={highlights}
                hoveredId={hoveredId}
                onHighlightClick={onHighlightClick}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== paged 模式：现状左右单页 =====
  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        gap: isMobile ? 16 : 20,
        alignItems: "flex-start",
        justifyContent: "center",
      }}
    >
      {/* 左侧：原始 PDF（英文原版面） */}
      <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "center" }}>
        <PdfCanvas
          fileUrl={fileUrl}
          page={page}
          scale={scale}
          variant="original"
          highlights={highlights}
          hoveredId={hoveredId}
          onHighlightClick={onHighlightClick}
        />
      </div>

      {/* 右侧：译文 PDF 或进度占位 */}
      <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "center" }}>
        <TranslationPane
          translatedFileUrl={translatedFileUrl}
          translationStatus={translationStatus}
          translationError={translationError}
          translationProgress={translationProgress}
          page={page}
          scale={scale}
          highlights={highlights}
          hoveredId={hoveredId}
          onHighlightClick={onHighlightClick}
        />
      </div>
    </div>
  );
}
