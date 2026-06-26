import TranslationPane from "./TranslationPane";

interface Props {
  translatedFileUrl: string; // 译文 PDF（mono，纯中文版面）
  translationStatus: string; // pending / running / done / failed
  translationError?: string | null;
  translationProgress?: number | null; // 0-100，running 时有值；null=暂未上报
  page: number; // 当前页（1-based，与其它模式共享）
  scale: number;
}

/**
 * 译文版面：只展示译文 PDF（中文，由 pdf2zh 生成，完整保留公式/图表/版面），
 * 居中单列，与「原版面」布局一致、仅 PDF 来源不同。
 * 翻译未完成时（TranslationPane 内部）显示翻译进度占位。
 */
export default function TranslatedView({
  translatedFileUrl,
  translationStatus,
  translationError,
  translationProgress,
  page,
  scale,
}: Props) {
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
