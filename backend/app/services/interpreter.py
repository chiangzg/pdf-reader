"""AI 解读服务：对选中文本做学术解读，SSE 流式输出。

解读结构（系统提示词约束）：
- 核心思想（一句话概括）
- 关键术语解释
- 通俗类比
- 在论文中的作用
"""
from __future__ import annotations

from collections.abc import Generator

from openai import OpenAI

from app.config import Settings

# 固定前缀 Prompt（命中 DeepSeek 上下文缓存）
SYSTEM_PROMPT = (
    "你是一位耐心的学术导师，帮助读者理解英文学术论文片段。"
    "请用中文对给定的文本片段进行解读，帮助读者真正理解其含义。\n"
    "【输出格式】严格按以下四段输出，每段以加粗的小标题开头：\n"
    "1. **核心思想**：用一两句话概括这段在讲什么。\n"
    "2. **关键术语**：解释文中出现的专业名词（如有），格式「术语：解释」。若无专业术语可省略。\n"
    "3. **通俗类比**：用一个生活中的类比帮助理解（如适用）。\n"
    "4. **在论文中的作用**：这段内容在整个研究中的作用（承上启下、动机、方法、结论等）。\n"
    "【要求】语言通俗、准确、精炼；不要逐句翻译原文，而是帮助理解。"
    "若片段较短或缺乏上下文，仍尽量给出合理解读，必要时指出可能需要更多上下文。"
)


class Interpreter:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = OpenAI(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
        )
        self.model = settings.deepseek_model

    def stream(self, text: str, context: str | None = None) -> Generator[str, None, None]:
        """首轮解读：流式生成解读文本（yield 增量字符串）。"""
        user_content = f"请解读以下论文片段：\n\n{text}"
        if context:
            user_content += f"\n\n（上下文参考：{context[:500]}）"

        stream = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            stream=True,
            temperature=0.4,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield delta.content

    def chat_stream(self, messages: list[dict]) -> Generator[str, None, None]:
        """追问：接收外部拼好的 LLM messages 数组（system + 历史问答 + 新问题），流式返回。

        与 stream() 的区别：不再自己拼 system/user，而是接收调用方组装好的完整上下文，
        使多轮对话的上下文由路由层（取历史 Message + 截断）统一管理。
        system 前缀固定含原文，命中 DeepSeek 上下文缓存以省钱。
        """
        stream = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=True,
            temperature=0.4,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield delta.content
