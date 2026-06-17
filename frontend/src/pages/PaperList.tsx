import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import type { PaperOut } from "../api/types";

export default function PaperList() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [papers, setPapers] = useState<PaperOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listPapers();
      setPapers(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setProgress(0);
      setError(null);
      try {
        const detail = await api.uploadPaper(file, setProgress);
        navigate(`/paper/${detail.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "上传失败");
        setUploading(false);
      }
    },
    [navigate]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm("确定删除这篇论文及其翻译？")) return;
      try {
        await api.deletePaper(id);
        setPapers((ps) => ps.filter((p) => p.id !== id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "删除失败");
      }
    },
    []
  );

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>PDF 翻译阅读器</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{user?.email}</span>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 13 }}
          >
            登出
          </button>
        </div>
      </div>
      <p style={{ color: "var(--muted)", marginTop: 4, marginBottom: 20 }}>
        上传英文论文，阅读时自动翻译为中文
      </p>

      <UploadZone
        uploading={uploading}
        progress={progress}
        onFile={handleUpload}
        onClick={() => fileRef.current?.click()}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f);
        }}
      />

      {error && (
        <div style={{ color: "#dc2626", marginTop: 12, padding: 12, background: "#fef2f2", borderRadius: 8 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 15, color: "var(--muted)", marginBottom: 12 }}>我的论文</h2>
        {loading ? (
          <div style={{ color: "var(--muted)" }}>加载中…</div>
        ) : papers.length === 0 ? (
          <div style={{ color: "var(--muted)", padding: 24, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 10 }}>
            还没有论文，上传一个开始阅读吧
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {papers.map((p) => (
              <PaperCard key={p.id} paper={p} onOpen={() => navigate(`/paper/${p.id}`)} onDelete={() => handleDelete(p.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UploadZone({
  uploading,
  progress,
  onFile,
  onClick,
}: {
  uploading: boolean;
  progress: number;
  onFile: (f: File) => void;
  onClick: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onClick={uploading ? undefined : onClick}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      style={{
        border: `2px dashed ${dragOver ? "var(--primary)" : "var(--border)"}`,
        borderRadius: 12,
        padding: 32,
        textAlign: "center",
        cursor: uploading ? "wait" : "pointer",
        background: dragOver ? "#eff6ff" : "#fff",
        transition: "all .15s",
      }}
    >
      {uploading ? (
        <div>
          <div style={{ marginBottom: 8 }}>上传解析中… {Math.round(progress * 100)}%</div>
          <div style={{ width: "100%", maxWidth: 300, height: 6, background: "var(--border)", borderRadius: 3, margin: "0 auto", overflow: "hidden" }}>
            <div style={{ width: `${progress * 100}%`, height: "100%", background: "var(--primary)", transition: "width .2s" }} />
          </div>
        </div>
      ) : (
        "点击或拖入 PDF 文件上传"
      )}
    </div>
  );
}

function PaperCard({ paper, onOpen, onDelete }: { paper: PaperOut; onOpen: () => void; onDelete: () => void }) {
  const statusInfo: Record<string, { text: string; color: string }> = {
    done: { text: "译文就绪", color: "#16a34a" },
    running: { text: "翻译中", color: "#d97706" },
    pending: { text: "等待翻译", color: "#8a9099" },
    failed: { text: "翻译失败", color: "#dc2626" },
  };
  const si = statusInfo[paper.translation_status] ?? statusInfo.pending;
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={onOpen}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {paper.title}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span>{paper.total_pages} 页</span>
          <span style={{ color: si.color }}>● {si.text}</span>
          <span>{new Date(paper.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      <button onClick={onDelete} style={delBtn}>
        删除
      </button>
    </div>
  );
}

const delBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "5px 10px",
  cursor: "pointer",
  fontSize: 12,
  color: "var(--muted)",
};
