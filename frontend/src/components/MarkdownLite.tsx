import { useMemo } from "react";
import MarkdownIt from "markdown-it";

/**
 * Markdown 渲染（markdown-it 驱动）。
 *
 * 用于 AI 解读输出：模型格式不可控（标题/列表/引用/代码/加粗…），
 * 手写解析器补不完且易出 XSS，故引入成熟库一次解决。
 *
 * 安全：html:false 禁止原始 HTML 标签注入，markdown-it 默认转义，
 * 故 AI 输出无法携带脚本，无需额外 DOMPurify。
 * InterpretPanel 与 RightDrawer 共用。
 */
const md = new MarkdownIt({
  html: false, // 禁止原始 HTML（AI 输出不可信，防 XSS）
  linkify: true, // 自动识别 URL 为链接
  breaks: false, // 标准 markdown 段落语义，单换行不转 <br>
  typographer: false,
});

export default function MarkdownLite({ text }: { text: string }) {
  const html = useMemo(() => md.render(text ?? ""), [text]);
  return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
