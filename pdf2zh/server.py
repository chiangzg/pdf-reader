"""pdf2zh 翻译服务（FastAPI 异步任务包装）。

绕过 pdf2zh 自带的 Gradio GUI——GUI 的 /translate_file 端点是为浏览器交互设计的，
其 *envs（翻译器环境变量）经 Gradio 序列化 + special_args 注入后极为脆弱：
API 调用者被迫为 progress 槽传值，该值会被 gradio 挤进 *envs[0]，导致真实
envs 整体后移、base_url 被置空，openai client 报 "Request URL is missing scheme"。

本服务直接调用 pdf2zh.high_level.translate，envs 以 JSON dict 传递，
彻底消除顺序/错位问题。backend 通过 httpx 调用本服务。

== 异步任务模式（根除翻译超时）==

翻译一篇论文耗时数分钟到十几分钟。早期实现是「POST /translate 阻塞到翻译完成
再返回」，backend 侧的 httpx 客户端必须把 read timeout 设得比翻译耗时还长，
否则会在翻译仍在进行时收到 ReadTimeout——服务端毫不知情、照常跑完，于是出现
「日志显示成功、页面报超时」的假象。

改为异步任务：
  POST /translate       提交任务，立即返回 {task_id, state}（HTTP 202，秒级）
  GET  /tasks/{task_id} 查询任务状态：{state, progress, mono_path?, dual_path?, error?}

backend 侧每次 HTTP 连接都是秒级短请求（提交 / 轮询），天然免疫超时；
progress 由 translate 的 callback 实时回写，backend 现查现返回。

== 串行执行 ==

doclayout ONNX 模型是进程级单例，translate() 非线程安全，多任务并发会损坏。
用全局 _exec_lock 强制一次只跑一个翻译，其余任务排队等待（state=pending）。

== 进度收集：callback 累计算法 ==

pdf2zh.high_level.translate 的 callback 在「页循环」里触发，参数是 tqdm 对象，
可读 pbar.n / pbar.total 算百分比。但 translate_stream 对同一份 doc 做了
mono + dual 两轮渲染，tqdm 会被重置两遍（n 从 0 重新增长），直接取 n/total
会导致进度从 ~50% 跳回 0%。

用累计绝对进度算法：检测到 n 回退（新一轮）就把上一轮的最终 n 累加进基线，
据此重估 total，保证进度单调不退、平滑增长。封顶 99% 避免假完成，
translate 返回后强制 100%。
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field

# babeldoc 用了 numpy 2.x 已移除的 np.fromstring，Dockerfile 已 patch 为 np.frombuffer
from pdf2zh.doclayout import OnnxModel
from pdf2zh.high_level import translate

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("pdf2zh.server")

# 版面分析 ONNX 模型：进程启动时加载一次（加载耗时数秒，避免每次翻译重复加载）。
# high_level.translate 依赖该模型做版面/段落识别；不传会报
# "'NoneType' object has no attribute 'predict'"。
logger.info("加载 doclayout ONNX 模型...")
DOC_LAYOUT_MODEL = OnnxModel.load_available()
logger.info("doclayout ONNX 模型加载完成")

app = FastAPI(title="pdf2zh translate service")

# 支持的翻译引擎。注意：值必须等于 translator.name（小写），
# 因为 high_level.translate -> converter 用 `service_name == translator.name` 匹配。
# service 格式为 "name" 或 "name:model"（如 "ollama:gemma2:9b"）。
SUPPORTED_SERVICES = {
    "openai",
    "deepseek",
    "openailiked",
    "google",
    "bing",
    "ollama",
    "gemini",
}


# ---------------------------------------------------------------------------
# 任务模型与全局任务表
# ---------------------------------------------------------------------------
@dataclass
class Task:
    """单个翻译任务的运行时状态。

    task_id 取源 PDF 文件名 stem（= backend 侧的 source_hash），天然幂等——
    同一文件重复提交会命中同一 task，避免并发翻译同一篇论文。

    last_n / accumulated 仅用于累计算法（见模块 docstring），不对外暴露。
    """

    task_id: str
    state: str = "pending"  # pending / running / done / failed
    progress: float = 0.0  # 0-100
    mono_path: str | None = None
    dual_path: str | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    # 累计算法内部状态
    last_n: int = 0
    accumulated: int = 0

    def to_status(self) -> dict:
        """返回对外可见的状态快照。"""
        return {
            "task_id": self.task_id,
            "state": self.state,
            "progress": round(self.progress, 1),
            "mono_path": self.mono_path,
            "dual_path": self.dual_path,
            "error": self.error,
        }


_tasks: dict[str, Task] = {}
# 任务表读写锁：保护 _tasks 字典的增删查改
_lock = threading.Lock()
# 翻译执行锁：ONNX 模型进程级单例非线程安全，强制翻译串行，多任务排队
_exec_lock = threading.Lock()


def _get_or_create_task(task_id: str) -> tuple[Task, bool]:
    """获取任务；不存在则创建。返回 (task, created)。"""
    with _lock:
        existing = _tasks.get(task_id)
        if existing is not None:
            return existing, False
        task = Task(task_id=task_id)
        _tasks[task_id] = task
        return task, True


# ---------------------------------------------------------------------------
# 请求/响应模型
# ---------------------------------------------------------------------------
class TranslateRequest(BaseModel):
    input_path: str = Field(..., description="容器内可读的源 PDF 绝对路径")
    output_dir: str = Field(..., description="容器内可写的输出目录绝对路径")
    lang_in: str = Field("en", description="源语言代码，如 en")
    lang_out: str = Field("zh", description="目标语言代码，如 zh")
    service: str = Field("OpenAI", description="翻译引擎名（pdf2zh service_map key）")
    envs: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "翻译器环境变量，按 key 传递。例如 OpenAI 引擎："
            '{"OPENAI_BASE_URL": "...", "OPENAI_API_KEY": "...", "OPENAI_MODEL": "..."}。'
            "不提供的 key 由 pdf2zh 内部回退到 os.environ。"
        ),
    )
    prompt: str | None = Field(default=None, description="自定义翻译 prompt（可选）")
    threads: int = Field(default=1, ge=1, description="翻译线程数")


class TranslateSubmitResponse(BaseModel):
    task_id: str
    state: str


# ---------------------------------------------------------------------------
# 翻译执行（后台线程）
# ---------------------------------------------------------------------------
def _make_callback(task: Task) -> object:
    """构造 translate 的 callback，把 tqdm 进度累计算法回写 task。

    返回一个可调用对象，签名为 callback(pbar)。translate 在每页处理完调用它，
    pbar 是 tqdm 实例（有 .n / .total）。见模块 docstring 的累计算法说明。
    """
    lock = _lock

    def cb(pbar) -> None:  # noqa: ANN001
        try:
            n = int(getattr(pbar, "n", 0) or 0)
            total = int(getattr(pbar, "total", 0) or 0)
        except Exception:  # noqa: BLE001
            return
        with lock:
            # 检测新一轮：tqdm 被重置（mono→dual），n 回退到 0
            if n < task.last_n:
                task.accumulated += task.last_n
            task.last_n = n
            est_total = task.accumulated + total
            done_so_far = task.accumulated + n
            if est_total > 0:
                task.progress = min(99.0, done_so_far / est_total * 100.0)
            else:
                task.progress = max(task.progress, 0.0)

    return cb


def _run_translate(req: TranslateRequest, task: Task) -> None:
    """后台线程主体：在 _exec_lock 内执行翻译，更新 task 状态。

    _exec_lock 保证一次只有一个翻译在跑（ONNX 模型非线程安全）。
    拿到锁前 state 保持 pending；拿到后置 running。
    """
    # 排队等待执行锁（可能前面有别的翻译在跑）
    with _exec_lock:
        with _lock:
            # 进入执行前再次检查：任务可能已被清理或处于终态
            if task.state in {"done", "failed"}:
                return
            task.state = "running"
            task.last_n = 0
            task.accumulated = 0

        logger.info("开始翻译: %s -> %s (service=%s)", req.input_path, req.output_dir, req.service)
        try:
            results = translate(
                files=[req.input_path],
                output=req.output_dir,
                lang_in=req.lang_in,
                lang_out=req.lang_out,
                service=req.service,
                envs=req.envs or None,
                thread=req.threads,
                model=DOC_LAYOUT_MODEL,
                callback=_make_callback(task),
            )
        except Exception as e:  # noqa: BLE001
            with _lock:
                task.state = "failed"
                task.error = f"{type(e).__name__}: {e}"
            logger.exception("翻译失败: %s", req.input_path)
            return

        if not results:
            with _lock:
                task.state = "failed"
                task.error = "翻译完成但未生成输出文件"
            logger.error("翻译未生成输出: %s", req.input_path)
            return

        mono_path, dual_path = results[0]
        with _lock:
            task.state = "done"
            task.progress = 100.0
            task.mono_path = mono_path
            task.dual_path = dual_path
        logger.info("翻译完成: mono=%s dual=%s", mono_path, dual_path)


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post(
    "/translate",
    response_model=TranslateSubmitResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def submit_translate(req: TranslateRequest) -> TranslateSubmitResponse:
    """提交翻译任务，立即返回 task_id。

    task_id = 源 PDF 文件名 stem（= backend 的 source_hash），幂等：
    同一文件重复提交命中同一 task。若该 task 已存在且非终态，直接复用，
    不会重复启动翻译线程。
    """
    src = Path(req.input_path)
    if not src.is_file():
        raise HTTPException(status_code=400, detail=f"输入文件不存在: {req.input_path}")

    if req.service not in SUPPORTED_SERVICES:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的翻译引擎: {req.service}（支持: {sorted(SUPPORTED_SERVICES)}）",
        )

    # 确保 output_dir 存在（提交阶段就建好，避免翻译线程里才发现权限问题）
    Path(req.output_dir).mkdir(parents=True, exist_ok=True)

    import os

    # 校验 OpenAI 系引擎的 envs 完整性，提前给出明确错误而非让 openai client 静默失败
    if req.service in {"openai", "openailiked"}:
        base_url_key = "OPENAI_BASE_URL" if req.service == "openai" else "OPENAILIKED_BASE_URL"
        base_url = req.envs.get(base_url_key) or os.environ.get(base_url_key)
        if not base_url or "://" not in base_url:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{base_url_key} 缺失或缺少 http(s):// scheme (got {base_url!r})。"
                    "翻译会因 base_url 为空而静默失败，请检查 envs。"
                ),
            )

    # task_id 取文件名 stem，与 backend 的 source_hash 一致，保证幂等
    task_id = src.stem
    task, created = _get_or_create_task(task_id)

    if created:
        # 新任务：启动后台翻译线程
        logger.info("提交翻译任务: task_id=%s input=%s", task_id, req.input_path)
        t = threading.Thread(
            target=_run_translate,
            args=(req, task),
            daemon=True,
            name=f"translate-{task_id[:12]}",
        )
        t.start()
    else:
        # 已存在：终态复用，非终态说明已在跑/排队中，都不重启
        logger.info(
            "复用已有任务 task_id=%s state=%s (created=%s)",
            task_id,
            task.state,
            created,
        )

    return TranslateSubmitResponse(task_id=task_id, state=task.state)


@app.get("/tasks/{task_id}")
def get_task(task_id: str) -> dict:
    """查询任务状态。任务不存在返回 404（供 backend 检测任务丢失）。"""
    with _lock:
        task = _tasks.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")
        return task.to_status()
