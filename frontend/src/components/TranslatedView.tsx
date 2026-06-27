import PdfCanvas from "./PdfCanvas";
import TranslationPane from "./TranslationPane";
import PdfScroll from "./PdfScroll";

interface Props {
  translatedFileUrl: string; // 译文 PDF（mono，纯中文版面）
  translationStatus: string; // pending / running / done / failed
  translationError?: string | null;
  translationProgress?: number | null; // 0-100，running 时有值；null=暂未上报
  page: number; // 当前页（1-based，与其它模式共享）
  scale: number;
  pageMode: "paged" | "scroll";
  onPageChange?: (page: number) => void;
}

/**
 * 译文版面：只展示译文 PDF（中文，由 pdf2zh 生成，完整保留公式/图表/版面）。
 * - paged：居中单页（PdfCanvas，与「原版面」一致），TranslationPane 处理翻译进度占位；
 * - scroll：译文就绪后用 PdfScroll 连续滚动，未就绪仍显示进度占位。
 */
export default function TranslatedView({
  translatedFileUrl,
  translationStatus,
  translationError,
  translationProgress,
  page,
  scale,
  pageMode,
  onPageChange,
}: Props) {
  const translatedReady = translationStatus === "done";

  // 译文未就绪：无论哪种翻页方式都显示翻译进度占位
  if (!translatedReady) {
    return (
      <div style={{ display: "flex", justifyContent: "center" }}>
        <TranslationPane
          translatedFileUrl={translatedFileUrl}
          translationStatus={translationStatus}
          translationError={translationError}
          translationProgress={translationProgress}
          page={page}
          scale={scale}
        />
      </div>
    );
  }

  if (pageMode === "scroll") {
    return (
      <PdfScroll
        fileUrl={translatedFileUrl}
        scale={scale}
        initialPage={page}
        onPageChange={onPageChange}
      />
    );
  }

  // paged：复用 PdfCanvas（加载+单页渲染，与原版面一致）
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <PdfCanvas fileUrl={translatedFileUrl} page={page} scale={scale} />
    </div>
  );
}
