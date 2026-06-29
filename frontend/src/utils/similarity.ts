/**
 * 划词智能识别：判断"重新选的句子"是否匹配某个既有会话，用于续接对话。
 *
 * 三层信号（从硬到软）：
 *  1. 归一化精确匹配（金标准，零误报）—— norm(a) === norm(b)
 *  2. SequenceMatcher 比率（模糊兜底，慎用）—— 学术文本重复高，阈值要高
 *  3. 几何 IoU（文本提取误差的佐证）—— 不独立触发，仅加权
 *
 * 纯函数，无依赖；在 SelectionToolbar 划词捕获后纯内存计算（highlights 已全量缓存）。
 */

/** 文本归一化：trim + 折叠空白 + 小写。消除 pdf.js textLayer 的空白/换行/大小写差异。 */
export function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Ratcliff-Obershelp 相似度（Python difflib.SequenceMatcher 的同款算法）。
 * 找两个串最长公共子序列，递归对左右剩余部分再找，最终 2·匹配长度 / 两串总长。
 * 返回 0~1。
 */
export function sequenceSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;
  if (na.length === 0 || nb.length === 0) return 0.0;

  // 找最长公共子串（非子序列，实现更简单且对 pdf 文本足够），累加匹配长度
  const matched = (x: string, y: string): number => {
    const m = x.length;
    const n = y.length;
    if (m === 0 || n === 0) return 0;
    // DP 找最长公共子串
    let bestLen = 0;
    let bestI = 0;
    let bestJ = 0;
    const dp: number[] = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      const prev = new Array(n + 1).fill(0);
      for (let j = 1; j <= n; j++) {
        if (x[i - 1] === y[j - 1]) {
          prev[j] = dp[j - 1] + 1;
          if (prev[j] > bestLen) {
            bestLen = prev[j];
            bestI = i;
            bestJ = j;
          }
        } else {
          prev[j] = 0;
        }
      }
      for (let j = 0; j <= n; j++) dp[j] = prev[j];
    }
    if (bestLen === 0) return 0;
    // 递归匹配去掉公共子串后的左右部分
    const leftX = x.slice(0, bestI - bestLen);
    const leftY = y.slice(0, bestJ - bestLen);
    const rightX = x.slice(bestI);
    const rightY = y.slice(bestJ);
    return bestLen + matched(leftX, leftY) + matched(rightX, rightY);
  };

  const totalMatched = matched(na, nb);
  return (2.0 * totalMatched) / (na.length + nb.length);
}

/** 归一化矩形（0~1）在某一页上的相交矩形，无相交返回 null。 */
interface NormRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsIoU(a: NormRect[], b: NormRect[]): number {
  // 取两组矩形（仅同页）的并集 IoU：面积交 / 面积并
  const all = [...a, ...b];
  if (all.length === 0) return 0;
  let inter = 0;
  let union = 0;
  for (const r of all) union += r.w * r.h;
  for (const ra of a) {
    for (const rb of b) {
      if (ra.page !== rb.page) continue;
      const ix = Math.max(0, Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x));
      const iy = Math.max(0, Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y));
      if (ix > 0 && iy > 0) inter += ix * iy;
    }
  }
  if (union <= 0) return 0;
  return inter / union;
}

/** 综合匹配结果 */
export interface MatchResult {
  /** 0~1 综合分 */
  score: number;
  /** 精确归一化文本匹配（强匹配，主操作可直接续接） */
  exact: boolean;
  /** 软匹配（文本很接近但不完全相同，仅提示） */
  soft: boolean;
}

/**
 * 判断一段新选区与某个候选会话的匹配度。
 * @param selText 新选中文本
 * @param selRects 新选中归一化矩形
 * @param candText 候选会话原文
 * @param candRects 候选会话归一化矩形
 */
export function matchHighlight(
  selText: string,
  selRects: NormRect[],
  candText: string,
  candRects: NormRect[]
): MatchResult {
  const textSim = sequenceSimilarity(selText, candText);
  const geoIoU = rectsIoU(selRects, candRects);
  // 综合分：文本为主(0.8)，几何作佐证(0.2)
  const score = 0.8 * textSim + 0.2 * geoIoU;
  const exact = normalize(selText) === normalize(candText);
  // 软匹配：综合分≥0.85 但非精确
  const soft = !exact && score >= 0.85;
  return { score, exact, soft };
}
