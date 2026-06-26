import PdfCanvas from "./PdfCanvas";

interface Props {
  translatedFileUrl: string; // 译文 PDF（mono，纯中文版面）
  translationStatus: string; // pending / running / done / failed
  translationError?: string | null;
  translationProgress?: number | null; // 0-100，running 时有值；null=暂未上报
  page: number; // 当前页（1-based）
  scale: number;
}

/**
 * 译文面板：复用于「译文版面」与「双语对照」的右栏。
 * 译文就绪（status=done）则用 PdfCanvas 渲染（带 TextLayer 可划词）；
 * 否则渲染翻译进度占位（确定进度条 / indeterminate / 失败提示）。
 */
export default function TranslationPane({
  translatedFileUrl,
  translationStatus,
  translationError,
  translationProgress,
  page,
  scale,
}: Props) {
  const translatedReady = translationStatus === "done";

  return translatedReady ? (
    <PdfCanvas fileUrl={translatedFileUrl} page={page} scale={scale} />
  ) : (
    <TranslationPlaceholder
      status={translationStatus}
      error={translationError}
      progress={translationProgress}
    />
  );
}

function TranslationPlaceholder({
  status,
  error,
  progress,
}: {
  status: string;
  error?: string | null;
  progress?: number | null;
}) {
  let title = "翻译中…";
  let desc = "正在生成保留公式与版面的中文 PDF，约需数分钟";
  if (status === "failed") {
    title = "翻译失败";
    desc = error || "翻译过程中出错，可点击工具栏「重新翻译」重试";
  } else if (status === "pending") {
    title = "等待翻译…";
    desc = "翻译任务已排队";
  } else if (status === "running" && typeof progress === "number") {
    title = `翻译中… ${Math.round(progress)}%`;
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
        gap: 12,
        border: "2px dashed var(--border)",
        borderRadius: 12,
        background: "#fff",
        color: "var(--muted)",
        padding: 20,
        textAlign: "center",
      }}
    >
      {status !== "failed" && (
        <ProgressBar status={status} progress={progress} />
      )}
      <div style={{ fontWeight: 600, fontSize: 15, color: "var(--fg)" }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>{desc}</div>
    </div>
  );
}

/**
 * 进度条：
 *  - running + 有 progress：确定进度条（灰底 + 主色填充，CSS transition 平滑）
 *  - running/pending + 无 progress：indeterminate 动画条（兜底，pdf2zh 排队/启动中）
 *  - failed：不渲染
 */
function ProgressBar({
  status,
  progress,
}: {
  status: string;
  progress?: number | null;
}) {
  // 确定进度：running 且有精确百分比
  if (status === "running" && typeof progress === "number") {
    const pct = Math.max(0, Math.min(100, progress));
    return (
      <div
        style={{
          width: "100%",
          maxWidth: 240,
          height: 6,
          background: "var(--border)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--primary)",
            borderRadius: 3,
            transition: "width .4s ease",
          }}
        />
      </div>
    );
  }
  // indeterminate 兜底：用现有 Spinner，语义一致（不确定等待）
  return <Spinner />;
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
