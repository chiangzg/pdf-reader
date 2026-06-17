import { useDevice } from "../hooks/useDevice";
import PdfCanvas from "./PdfCanvas";

interface Props {
  fileUrl: string; // 原始 PDF（英文）
  translatedFileUrl: string; // 译文 PDF（mono，纯中文版面）
  translationStatus: string; // pending / running / done / failed
  translationError?: string | null;
  page: number; // 当前页（1-based，与原版面模式共享）
  scale: number;
}

/**
 * 双语对照：左侧原始 PDF（英文，保留原版面），右侧译文 PDF（中文，由 pdf2zh 生成，
 * 完整保留公式/图表/版面）。两列都用 PdfCanvas 渲染，均带 TextLayer 可划词。
 *
 * 翻译未完成时右侧显示「翻译中…」占位；翻译失败显示错误 + 重试提示。
 * PC 左右并排；移动端上下叠放。
 */
export default function BilingualView({
  fileUrl,
  translatedFileUrl,
  translationStatus,
  translationError,
  page,
  scale,
}: Props) {
  const { isMobile } = useDevice();
  const translatedReady = translationStatus === "done";

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

      {/* 右侧：译文 PDF 或占位 */}
      <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "center" }}>
        {translatedReady ? (
          <PdfCanvas fileUrl={translatedFileUrl} page={page} scale={scale} />
        ) : (
          <TranslationPlaceholder status={translationStatus} error={translationError} />
        )}
      </div>
    </div>
  );
}

function TranslationPlaceholder({
  status,
  error,
}: {
  status: string;
  error?: string | null;
}) {
  let title = "翻译中…";
  let desc = "正在生成保留公式与版面的中文 PDF，约需 1-3 分钟";
  if (status === "failed") {
    title = "翻译失败";
    desc = error || "翻译过程中出错，可点击工具栏「重新翻译」重试";
  } else if (status === "pending") {
    title = "等待翻译…";
    desc = "翻译任务已排队";
  }
  return (
    <div
      style={{
        width: 300,
        height: 400,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        border: "2px dashed var(--border)",
        borderRadius: 12,
        background: "#fff",
        color: "var(--muted)",
        padding: 20,
        textAlign: "center",
      }}
    >
      {status !== "failed" && <Spinner />}
      <div style={{ fontWeight: 600, fontSize: 15, color: "var(--fg)" }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>{desc}</div>
    </div>
  );
}

function Spinner() {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        border: "3px solid var(--border)",
        borderTopColor: "var(--primary)",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}
