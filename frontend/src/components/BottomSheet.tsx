import { useEffect, useRef, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 占屏高比例 */
  heightRatio?: number;
}

/**
 * 移动端底部抽屉：从底部滑入，支持下滑手势关闭。
 * 背景遮罩点击关闭。
 */
export default function BottomSheet({ open, onClose, children, heightRatio = 0.65 }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (open) setDragY(0);
  }, [open]);

  // 阻止背景滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  if (!open) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setDragY(dy); // 仅向下滑动跟随
  };
  const handleTouchEnd = () => {
    if (startY.current === null) return;
    // 下滑超过 80px 视为关闭
    if (dragY > 80) {
      onClose();
    }
    setDragY(0);
    startY.current = null;
  };

  const sheetHeight = `${heightRatio * 100}vh`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,.4)",
        display: "flex",
        alignItems: "flex-end",
        animation: "fadeIn .15s",
      }}
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          width: "100%",
          height: sheetHeight,
          maxHeight: "85vh",
          background: "#fff",
          borderRadius: "16px 16px 0 0",
          boxShadow: "0 -4px 24px rgba(0,0,0,.15)",
          transform: `translateY(${dragY}px)`,
          transition: dragY === 0 ? "transform .25s ease" : "none",
          display: "flex",
          flexDirection: "column",
          touchAction: "none",
        }}
      >
        {/* 拖拽指示条 */}
        <div
          style={{
            padding: "10px 0 6px",
            display: "flex",
            justifyContent: "center",
            cursor: "grab",
            flexShrink: 0,
          }}
        >
          <div style={{ width: 40, height: 4, background: "#d1d5db", borderRadius: 2 }} />
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 16px 24px" }}>{children}</div>
      </div>
    </div>
  );
}
