import { useEffect, useState } from "react";

export interface DeviceInfo {
  isTouch: boolean; // 触摸设备（移动端/平板）
  isMobile: boolean; // 窄屏（<768px）
  isDesktop: boolean; // PC
}

/**
 * 设备识别：综合 pointer 类型与屏幕宽度判断。
 * 不只依赖 CSS 断点，因交互行为（选区/浮窗）需在 JS 层分治。
 */
export function useDevice(): DeviceInfo {
  const compute = (): DeviceInfo => {
    if (typeof window === "undefined") {
      return { isTouch: false, isMobile: false, isDesktop: true };
    }
    const fine = window.matchMedia("(pointer: fine)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.matchMedia("(max-width: 767px)").matches;
    return {
      isTouch: coarse || (!fine && narrow),
      isMobile: narrow,
      isDesktop: !narrow && fine,
    };
  };

  const [device, setDevice] = useState<DeviceInfo>(compute);

  useEffect(() => {
    const mq1 = window.matchMedia("(pointer: fine)");
    const mq2 = window.matchMedia("(pointer: coarse)");
    const mq3 = window.matchMedia("(max-width: 767px)");
    const handler = () => setDevice(compute());
    mq1.addEventListener?.("change", handler);
    mq2.addEventListener?.("change", handler);
    mq3.addEventListener?.("change", handler);
    window.addEventListener("resize", handler);
    return () => {
      mq1.removeEventListener?.("change", handler);
      mq2.removeEventListener?.("change", handler);
      mq3.removeEventListener?.("change", handler);
      window.removeEventListener("resize", handler);
    };
  }, []);

  return device;
}
