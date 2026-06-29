import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Highlight, PaperDetail } from "../api/types";
import { useDevice } from "../hooks/useDevice";
import { useSelection, toHighlightCoords } from "../hooks/useSelection";
import PdfCanvas from "../components/PdfCanvas";
import PdfScroll from "../components/PdfScroll";
import BilingualView from "../components/BilingualView";
import TranslatedView from "../components/TranslatedView";
import SelectionToolbar from "../components/SelectionToolbar";
import InterpretPanel from "../components/InterpretPanel";
import RightDrawer from "../components/RightDrawer";

type Mode = "overlay" | "translated" | "bilingual";
type PageMode = "paged" | "scroll";

const PAGE_MODE_KEY = "reader.pageMode";
const DRAWER_KEY = "reader.drawerOpen";
function readPageMode(): PageMode {
  try {
    const v = localStorage.getItem(PAGE_MODE_KEY);
    return v === "scroll" ? "scroll" : "paged";
  } catch {
    return "paged";
  }
}
function readDrawerOpen(): boolean {
  try {
    return localStorage.getItem(DRAWER_KEY) !== "0";
  } catch {
    return true;
  }
}

export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const paperId = Number(id);
  const { isMobile } = useDevice();

  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 翻译状态（轮询）
  const [translationStatus, setTranslationStatus] = useState<string>("pending");
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationProgress, setTranslationProgress] = useState<number | null>(null);

  // 共享阅读状态：模式切换不丢失
  const [mode, setMode] = useState<Mode>("overlay");
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.4);
  // 翻页方式：左右翻页 / 上下滚动（全局偏好，存 localStorage）
  const [pageMode, setPageMode] = useState<PageMode>(readPageMode);

  // 划词解读状态
  const contentRef = useRef<HTMLDivElement>(null);
  const [interpretText, setInterpretText] = useState<string | null>(null);
  const [interpretRect, setInterpretRect] = useState<DOMRect | null>(null);
  // 最近一次划词的选区信息（含 page/variant/normRects），解读完成后用于落库
  const lastSelectionRef = useRef<{
    page: number;
    variant: "original" | "translated";
    text: string;
    normRects: { page: number; x: number; y: number; w: number; h: number }[];
  } | null>(null);

  // 划词历史
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(readDrawerOpen);

  const { selection, clear: clearSelection } = useSelection(contentRef);

  // 加载论文 + 进度
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await api.getPaper(paperId);
        if (cancelled) return;
        setPaper(detail);
        setTranslationStatus(detail.translation_status);
        setTranslationError(detail.translation_error);
        setTranslationProgress(null);
        let initMode: Mode = isMobile ? "bilingual" : "overlay";
        let initPage = 1;
        try {
          const prog = await api.getProgress(paperId);
          if (prog.has_record) {
            initMode = prog.mode as Mode;
            initPage = Math.max(1, Math.min(prog.page, detail.total_pages));
          }
        } catch {
          /* 忽略 */
        }
        // 拉取划词历史（一次拉全量，前端缓存）
        try {
          const hs = await api.listHighlights(paperId);
          if (!cancelled) setHighlights(hs);
        } catch {
          /* 忽略：未登录或后端不可达，划词历史为空 */
        }
        if (!cancelled) {
          setMode(initMode);
          setPage(initPage);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperId, isMobile]);

  const totalPages = paper?.total_pages ?? 1;

  // 切换翻页方式：写入 localStorage（全局偏好）
  const changePageMode = (m: PageMode) => {
    setPageMode(m);
    try {
      localStorage.setItem(PAGE_MODE_KEY, m);
    } catch {
      /* 忽略 */
    }
  };

  // 键盘快捷键：仅「左右翻页」模式下，← 上一页 / → 下一页（仅这两个键）。
  // scroll 模式不劫持键盘，依赖浏览器原生滚动。
  useEffect(() => {
    if (pageMode !== "paged") return;
    const onKey = (e: KeyboardEvent) => {
      // 输入框/文本域内不响应，避免影响划词与表单
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPage((p) => Math.max(1, p - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPage((p) => Math.min(totalPages, p + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageMode, totalPages]);

  // 进度上报
  useEffect(() => {
    if (!paper) return;
    const timer = setTimeout(() => {
      api.saveProgress(paperId, { mode, page, scroll_ratio: 0 }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [paperId, paper, mode, page]);

  // 翻译状态轮询：running 时 2s（进度条丝滑），其余 5s；done/failed 停止
  useEffect(() => {
    if (translationStatus === "done" || translationStatus === "failed") return;
    let active = true;
    // 用 ref 让轮询循环读到最新状态，决定下一次间隔
    const statusRef = { current: translationStatus };
    const poll = async () => {
      while (active) {
        // running 加快到 2s，其它 5s
        const interval = statusRef.current === "running" ? 2000 : 5000;
        await new Promise((r) => setTimeout(r, interval));
        if (!active) break;
        try {
          const st = await api.translationStatus(paperId);
          if (!active) break;
          setTranslationStatus(st.status);
          setTranslationError(st.error);
          setTranslationProgress(st.progress ?? null);
          statusRef.current = st.status;
          if (st.status === "done" || st.status === "failed") break;
        } catch {
          break;
        }
      }
    };
    poll();
    return () => {
      active = false;
    };
  }, [paperId, translationStatus]);

  const handleRetryTranslate = async () => {
    try {
      const st = await api.retryTranslate(paperId);
      setTranslationStatus(st.status);
      setTranslationError(null);
      setTranslationProgress(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "触发翻译失败");
    }
  };

  const handleInterpret = (text: string, rect: DOMRect) => {
    // selection 来自 useSelection，已带 page/variant/normRects，落库时复用
    if (selection) {
      lastSelectionRef.current = {
        page: selection.page,
        variant: selection.variant,
        text: selection.text,
        normRects: selection.normRects,
      };
    }
    setInterpretText(text);
    setInterpretRect(rect);
  };

  const closeInterpret = () => {
    setInterpretText(null);
    setInterpretRect(null);
    clearSelection();
  };

  /** SSE 解读完成 → 落库，成功后本地 unshift 新记录到抽屉顶部 */
  const handleInterpretDone = async (fullResult: string) => {
    const sel = lastSelectionRef.current;
    if (!sel || !fullResult.trim()) return;
    try {
      const created = await api.createHighlight(paperId, {
        variant: sel.variant,
        text: sel.text,
        result: fullResult,
        coords: toHighlightCoords(sel.normRects),
      });
      setHighlights((hs) => [created, ...hs]);
    } catch {
      /* 落库失败不影响用户已看到的解读 */
    }
  };

  const handleDeleteHighlight = async (id: number) => {
    setHighlights((hs) => hs.filter((h) => h.id !== id));
    try {
      await api.deleteHighlight(id);
    } catch {
      /* 删除失败已乐观移除前端，忽略后端错误 */
    }
  };

  const changeDrawer = (open: boolean) => {
    setDrawerOpen(open);
    try {
      localStorage.setItem(DRAWER_KEY, open ? "1" : "0");
    } catch {
      /* 忽略 */
    }
  };

  /** 点击正文中的下划线 → 打开抽屉并高亮对应记录 */
  const handleHighlightClick = (h: Highlight) => {
    setHoveredId(h.id);
    if (!drawerOpen) changeDrawer(true);
  };

  if (loading) return <Center>加载中…</Center>;
  if (error)
    return (
      <Center>
        <div style={{ color: "#dc2626" }}>{error}</div>
        <button onClick={() => navigate("/")} style={{ marginTop: 12 }}>
          返回
        </button>
      </Center>
    );
  if (!paper) return <Center>未找到论文</Center>;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Toolbar
        paper={paper}
        mode={mode}
        onModeChange={setMode}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        scale={scale}
        onScaleChange={setScale}
        pageMode={pageMode}
        onPageModeChange={changePageMode}
        translationStatus={translationStatus}
        translationProgress={translationProgress}
        onRetryTranslate={handleRetryTranslate}
        onBack={() => navigate("/")}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => changeDrawer(!drawerOpen)}
      />

      {/* 正文 + 右侧抽屉：PC 挤压式 flex row；移动端抽屉由 RightDrawer 自身处理 */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div
          ref={contentRef}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: pageMode === "scroll" ? "hidden" : "auto",
            padding: pageMode === "scroll" ? 0 : 16,
            background: "var(--bg)",
          }}
        >
          {mode === "overlay" ? (
            pageMode === "scroll" ? (
              <PdfScroll
                fileUrl={api.paperFileUrl(paperId)}
                scale={scale}
                initialPage={page}
                onPageChange={setPage}
                highlights={highlights}
                hoveredId={hoveredId}
                onHighlightClick={handleHighlightClick}
              />
            ) : (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <PdfCanvas
                  fileUrl={api.paperFileUrl(paperId)}
                  page={page}
                  scale={scale}
                  highlights={highlights}
                  hoveredId={hoveredId}
                  onHighlightClick={handleHighlightClick}
                />
              </div>
            )
          ) : mode === "translated" ? (
            <TranslatedView
              translatedFileUrl={api.translatedFileUrl(paperId)}
              translationStatus={translationStatus}
              translationError={translationError}
              translationProgress={translationProgress}
              page={page}
              scale={scale}
              pageMode={pageMode}
              onPageChange={setPage}
              highlights={highlights}
              hoveredId={hoveredId}
              onHighlightClick={handleHighlightClick}
            />
          ) : (
            <BilingualView
              fileUrl={api.paperFileUrl(paperId)}
              translatedFileUrl={api.translatedFileUrl(paperId)}
              translationStatus={translationStatus}
              translationError={translationError}
              translationProgress={translationProgress}
              page={page}
              scale={scale}
              pageMode={pageMode}
              onPageChange={setPage}
              highlights={highlights}
              hoveredId={hoveredId}
              onHighlightClick={handleHighlightClick}
            />
          )}
        </div>

        {drawerOpen && (
          <RightDrawer
            highlights={highlights}
            currentPage={page}
            open={drawerOpen}
            onClose={() => changeDrawer(false)}
            onHover={setHoveredId}
            activeId={hoveredId}
            onDelete={handleDeleteHighlight}
          />
        )}
      </div>

      <SelectionToolbar rect={selection?.rect ?? null} text={selection?.text ?? null} onInterpret={handleInterpret} />
      <InterpretPanel
        text={interpretText}
        anchorRect={interpretRect}
        onClose={closeInterpret}
        onDone={handleInterpretDone}
      />
    </div>
  );
}

function Toolbar(props: {
  paper: PaperDetail;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  scale: number;
  onScaleChange: (s: number) => void;
  pageMode: PageMode;
  onPageModeChange: (m: PageMode) => void;
  translationStatus: string;
  translationProgress?: number | null;
  onRetryTranslate: () => void;
  onBack: () => void;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
}) {
  const {
    paper,
    mode,
    onModeChange,
    page,
    totalPages,
    onPageChange,
    scale,
    onScaleChange,
    pageMode,
    onPageModeChange,
    translationStatus,
    translationProgress,
    onRetryTranslate,
    onBack,
    drawerOpen,
    onToggleDrawer,
  } = props;

  const statusText =
    translationStatus === "done"
      ? "译文就绪"
      : translationStatus === "running"
      ? typeof translationProgress === "number"
        ? `翻译中 ${Math.round(translationProgress)}%`
        : "翻译中…"
      : translationStatus === "failed"
      ? "翻译失败"
      : "等待翻译";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: "#fff",
        borderBottom: "1px solid var(--border)",
        flexWrap: "wrap",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}
    >
      <button onClick={onBack} style={ghostBtn}>
        ← 返回
      </button>
      <strong style={{ fontSize: 14, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {paper.title}
      </strong>

      <div style={{ display: "flex", background: "var(--bg)", borderRadius: 8, padding: 3, border: "1px solid var(--border)" }}>
        {(["overlay", "translated", "bilingual"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            style={{
              ...modeBtn,
              background: mode === m ? "var(--primary)" : "transparent",
              color: mode === m ? "#fff" : "var(--fg)",
            }}
          >
            {m === "overlay" ? "原版面" : m === "translated" ? "译文" : "双语对照"}
          </button>
        ))}
      </div>

      <span style={{ fontSize: 12, color: "var(--muted)" }}>{statusText}</span>

      <div style={{ flex: 1 }} />

      {/* 划词历史抽屉开关 */}
      <button
        onClick={onToggleDrawer}
        title={drawerOpen ? "收起划词记录" : "展开划词记录"}
        style={{ ...ghostBtn, background: drawerOpen ? "var(--primary)" : "transparent", color: drawerOpen ? "#fff" : "var(--fg)" }}
      >
        📖 历史
      </button>

      {/* 翻页方式：左右翻页 / 上下滚动 */}
      <div style={{ display: "flex", background: "var(--bg)", borderRadius: 8, padding: 3, border: "1px solid var(--border)" }}>
        {(["paged", "scroll"] as PageMode[]).map((pm) => (
          <button
            key={pm}
            onClick={() => onPageModeChange(pm)}
            title={pm === "paged" ? "左右翻页（← →）" : "上下滚动翻页（滚轮/触控板）"}
            style={{
              ...modeBtn,
              background: pageMode === pm ? "var(--primary)" : "transparent",
              color: pageMode === pm ? "#fff" : "var(--fg)",
            }}
          >
            {pm === "paged" ? "左右" : "滚动"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} style={ghostBtn}>
          ‹
        </button>
        <span style={{ fontSize: 13 }}>
          {page}/{totalPages}
        </span>
        <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={ghostBtn}>
          ›
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button onClick={() => onScaleChange(Math.max(0.6, scale - 0.2))} style={ghostBtn}>
          －
        </button>
        <span style={{ fontSize: 12, width: 36, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
        <button onClick={() => onScaleChange(Math.min(3, scale + 0.2))} style={ghostBtn}>
          ＋
        </button>
      </div>

      {(translationStatus === "failed" || translationStatus === "pending") && (
        <button onClick={onRetryTranslate} style={primaryBtn}>
          重新翻译
        </button>
      )}
    </div>
  );
}

const Center: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 8 }}>
    {children}
  </div>
);

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "5px 10px",
  cursor: "pointer",
  fontSize: 13,
};

const modeBtn: React.CSSProperties = {
  border: "none",
  borderRadius: 6,
  padding: "5px 12px",
  cursor: "pointer",
  fontSize: 13,
  transition: "all .12s",
};

const primaryBtn: React.CSSProperties = {
  background: "var(--primary)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "6px 14px",
  cursor: "pointer",
  fontSize: 13,
};
