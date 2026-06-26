import { useDevice } from "../hooks/useDevice";
import PdfCanvas from "./PdfCanvas";
import TranslationPane from "./TranslationPane";

interface Props {
  fileUrl: string; // 原始 PDF（英文）
  translatedFileUrl: string; // 译文 PDF（mono，纯中文版面）
  translationStatus: string; // pending / running / done / failed
  translationError?: string | null;
  translationProgress?: number | null; // 0-100，running 时有值；null=暂未上报
  page: number; // 当前页（1-based，与原版面模式共享）
  scale: number;
}

/**
 * 双语对照：左侧原始 PDF（英文，保留原版面），右侧译文 PDF（中文，由 pdf2zh 生成，
 * 完整保留公式/图表/版面）。两列都用 PdfCanvas 渲染，均带 TextLayer 可划词。
 *
 * 翻译未完成时右侧（TranslationPane 内部）显示翻译进度占位：
 *  - 有精确进度（0-100）：百分比 + 确定进度条
 *  - 无精确进度（null）：indeterminate 动画条（pdf2zh 排队/启动中）
 * 翻译失败显示错误 + 重试提示。
 * PC 左右并排；移动端上下叠放。
 */
export default function BilingualView({
  fileUrl,
  translatedFileUrl,
  translationStatus,
  translationError,
  translationProgress,
  page,
  scale,
}: Props) {
  const { isMobile } = useDevice();

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
        <PdfCanvas fileUrl={fileUrl} page={page} scale={scale} />
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
        />
      </div>
    </div>
  );
}
