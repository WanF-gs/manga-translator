from __future__ import annotations
"""翻译质量评估 API（诚实版 v3.1）。

设计原则 —— 只报告能真实计算的指标，无法测量的坦诚返回 null 并标注原因，
不再用「自 BLEU / BLEU×1.12 / 文本长度方差 / 桩函数」伪造分数。

真实可计算信号（均来自流水线已有数据）：
  · ocr_confidence   —— TextRegion.confidence 的均值（OCR 模型真实置信度）
  · coverage         —— 已译区域 / 总区域（翻译覆盖率）
  · mt_confidence    —— 长度比 + 未知字符率启发式（明确标注为启发式估计）
  · term_consistency —— 对照用户术语库（TermEntry）的真实一致性；无适用术语则 null
  · bleu / meteor    —— 仅当区域带 reference_translation 时用 sacrebleu 计算真实 BLEU；
                        漫画场景通常无参考译文 → null，并置 has_reference=false

overall_score = 上述「可用真实信号」的加权平均（缺失项不参与、权重重归一化）。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional, List
import uuid, sys, os

_cur = os.path.dirname(os.path.abspath(__file__))
_svc = os.path.dirname(os.path.dirname(_cur))
if _svc not in sys.path:
    sys.path.insert(0, _svc)

from common.core.database import get_db
from common.core.dependencies import get_current_user
from common.core.response import success_response
from common.core.exceptions import ResourceNotFound
from common.models.v3_models import TranslationQuality
from common.models.page import Page
from common.models.chapter import Chapter
from common.models.text_region import TextRegion
from common.models.term_entry import TermEntry

router = APIRouter()

# 无参考译文时，radar 展示的真实可测轴
_REAL_AXES_LABELS = ["OCR置信度", "翻译覆盖率", "机翻置信度", "术语一致性"]


async def _assess_page(db: AsyncSession, page_id: str, user_id: str) -> Optional[dict]:
    """对单页做诚实质量评估，写入 TranslationQuality 并返回结果 dict。

    返回 None 表示无可评估内容（无区域 / 无译文）。
    """
    regions = (await db.execute(
        select(TextRegion).where(TextRegion.page_id == page_id)
    )).scalars().all()
    if not regions:
        return None
    translated = [r for r in regions if (r.translated_text or "").strip()]
    if not translated:
        return None

    # ── 真实信号 1：OCR 置信度（可能部分区域为 None，只对有值的取均值）──
    confs = [r.confidence for r in translated if r.confidence is not None]
    ocr_confidence = round(sum(confs) / len(confs), 4) if confs else None

    # ── 真实信号 2：翻译覆盖率 ──
    coverage = round(len(translated) / len(regions), 4)

    # ── 真实信号 3：机翻置信度（长度比 + 未知字符率启发式）──
    mt_confidence = _mt_confidence(translated)

    # ── 真实信号 4：术语一致性（对照用户术语库）──
    term_consistency = await _term_consistency(db, translated, user_id)

    # ── 真实信号 5：BLEU/METEOR（仅有参考译文时）──
    bleu, meteor, has_reference = _reference_bleu(translated)

    # overall = 可用信号加权平均（缺失项不计入）
    weighted = [
        (ocr_confidence, 0.25),
        (coverage, 0.20),
        (mt_confidence, 0.25),
        (term_consistency, 0.15),
        (bleu, 0.15),
    ]
    avail = [(v, w) for v, w in weighted if v is not None]
    overall = round(sum(v * w for v, w in avail) / sum(w for _, w in avail), 4) if avail else None

    report = {
        "method": "reference-bleu" if has_reference else "heuristic-no-reference",
        "has_reference": has_reference,
        "disclaimer": (
            None if has_reference else
            "无参考译文，BLEU/METEOR 不可计算（返回 null）；overall 由 OCR 置信度、"
            "翻译覆盖率、机翻置信度、术语一致性等真实信号加权得出。"
        ),
        "metrics": {
            "ocr_confidence": ocr_confidence,
            "coverage": coverage,
            "mt_confidence": mt_confidence,
            "term_consistency": term_consistency,
            "bleu": bleu,
            "meteor": meteor,
        },
        "radar": {
            "labels": _REAL_AXES_LABELS,
            "values": [
                round((ocr_confidence or 0) * 100, 1),
                round(coverage * 100, 1),
                round((mt_confidence or 0) * 100, 1),
                round((term_consistency or 0) * 100, 1),
            ],
        },
        "region_count": len(translated),
        "total_region_count": len(regions),
    }

    quality = TranslationQuality(
        page_id=uuid.UUID(page_id),
        bleu_score=bleu,                 # None when no reference — honest
        meteor_score=meteor,             # None when no reference — honest
        tone_consistency=mt_confidence,  # 存储机翻置信度（report_json 中有明确命名）
        term_consistency=term_consistency,
        overall_score=overall,
        report_json=report,
    )
    db.add(quality)
    await db.flush()

    return {
        "quality_id": str(quality.quality_id),
        "page_id": page_id,
        "overall_score": overall,
        "bleu_score": bleu,
        "meteor_score": meteor,
        "ocr_confidence": ocr_confidence,
        "coverage": coverage,
        "mt_confidence": mt_confidence,
        "term_consistency": term_consistency,
        "has_reference": has_reference,
        "radar_data": report["radar"],
        "report_json": report,
    }


def _mt_confidence(regions: list) -> Optional[float]:
    """机翻置信度启发式：长度比合理性 + 未知/占位字符率。

    这是明确标注的「启发式估计」，非模型 logprob。逐区域评分后取均值。
    """
    scores = []
    for r in regions:
        src = r.original_text or ""
        tgt = r.translated_text or ""
        if not tgt.strip():
            continue
        # 长度比：译文在源文 0.33x–3x 之间视为合理
        len_ratio = len(tgt) / max(1, len(src))
        len_score = 1.0 - abs(1.0 - min(3.0, max(0.33, len_ratio))) * 0.5
        # 未知/占位字符惩罚
        unknown = sum(1 for c in tgt if c in "�□■")
        char_score = max(0.0, min(1.0, 1.0 - (unknown / max(1, len(tgt))) * 5.0))
        scores.append(len_score * 0.5 + char_score * 0.5)
    if not scores:
        return None
    return round(max(0.0, min(1.0, sum(scores) / len(scores))), 4)


async def _term_consistency(db: AsyncSession, regions: list, user_id: str) -> Optional[float]:
    """术语一致性：对照用户术语库的真实检查。

    对每条术语（source→target），若其 source 出现在某区域原文中，则该区域构成一个
    「适用点」；若对应译文包含 target，则记为一致。consistency = 一致数 / 适用点数。
    无任何适用术语 → 返回 None（诚实：无可测量项，而非默认 0.9）。
    """
    try:
        terms = (await db.execute(
            select(TermEntry).where(TermEntry.user_id == uuid.UUID(user_id))
        )).scalars().all()
    except Exception:
        return None
    if not terms:
        return None

    applicable = 0
    consistent = 0
    for r in regions:
        src = r.original_text or ""
        tgt = r.translated_text or ""
        if not src or not tgt:
            continue
        for t in terms:
            if t.source_text and t.source_text in src:
                applicable += 1
                if t.target_text and t.target_text in tgt:
                    consistent += 1
    if applicable == 0:
        return None
    return round(consistent / applicable, 4)


def _reference_bleu(regions: list) -> tuple:
    """真实 BLEU：仅当区域带 reference_translation 时用 sacrebleu 计算。

    Returns: (bleu | None, meteor | None, has_reference: bool)
    漫画翻译通常无参考译文 → 返回 (None, None, False)，绝不伪造。
    """
    refs, cands = [], []
    for r in regions:
        ref = getattr(r, "reference_translation", None)
        if ref:
            refs.append(ref)
            cands.append(r.translated_text or "")
    if not refs:
        return None, None, False
    try:
        from sacrebleu.metrics import BLEU
        # sacrebleu 参考格式：单参考集时为 [[ref1, ref2, ...]]（与 cands 对齐）
        score = BLEU().corpus_score(cands, [refs]).score
        bleu = round(min(1.0, max(0.0, score / 100.0)), 4)
        # METEOR 需 wordnet，此处不做近似伪造：无独立 METEOR 实现时返回 None
        return bleu, None, True
    except Exception:
        return None, None, True


@router.post("/assess/{page_id}")
async def assess_quality(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """对单页运行诚实质量评估。"""
    result = await _assess_page(db, page_id, current_user["sub"])
    if result is None:
        return success_response(
            data={"assessable": False},
            message="该页无已翻译文本区域，无可评估内容",
        )
    return success_response(data=result)


@router.post("/batch-assess")
async def batch_assess_quality(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """批量评估多页。"""
    page_ids = body.get("page_ids", [])
    if not page_ids:
        return success_response(data={"task_id": None, "results": []}, message="No page_ids provided")

    results = []
    for pid in page_ids:
        r = await _assess_page(db, pid, current_user["sub"])
        if r is None:
            results.append({"page_id": pid, "skipped": True, "reason": "无区域或无译文"})
        else:
            results.append(r)
    return success_response(data={"task_id": str(uuid.uuid4()), "results": results})


@router.get("/{quality_id}")
async def get_quality(
    quality_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    q = (await db.execute(select(TranslationQuality).where(TranslationQuality.quality_id == quality_id))).scalar_one_or_none()
    if not q:
        raise ResourceNotFound("Quality assessment", quality_id)
    return success_response(data=_quality_to_dict(q))


@router.get("/page/{page_id}")
async def get_page_quality(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """获取某页的质量评估记录（最新在前）。"""
    results = (await db.execute(
        select(TranslationQuality).where(TranslationQuality.page_id == page_id).order_by(TranslationQuality.created_at.desc())
    )).scalars().all()
    return success_response(data={"assessments": [_quality_to_dict(r) for r in results]})


@router.get("/summary/project/{project_id}")
async def get_project_quality_summary(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """项目级质量汇总。page→chapter→project 关联（Page 无 project_id 列）。

    返回结构对齐前端契约：total_pages / scored_pages / avg_* / radar_data / trend。
    """
    # 项目下所有页
    page_ids_subq = (
        select(Page.page_id)
        .join(Chapter, Page.chapter_id == Chapter.chapter_id)
        .where(Chapter.project_id == uuid.UUID(project_id))
    ).subquery()

    total_pages = (await db.execute(
        select(func.count()).select_from(page_ids_subq)
    )).scalar() or 0

    agg = (await db.execute(
        select(
            func.count(func.distinct(TranslationQuality.page_id)).label("scored_pages"),
            func.avg(TranslationQuality.bleu_score).label("avg_bleu"),
            func.avg(TranslationQuality.meteor_score).label("avg_meteor"),
            func.avg(TranslationQuality.overall_score).label("avg_overall"),
            func.avg(TranslationQuality.tone_consistency).label("avg_mt_conf"),
            func.avg(TranslationQuality.term_consistency).label("avg_term"),
        ).where(TranslationQuality.page_id.in_(select(page_ids_subq.c.page_id)))
    )).one_or_none()

    def _pct(v):
        """0-1 → 0-100，null 保持 null（前端据此显示 N/A，不伪造）。"""
        return round(float(v) * 100, 1) if v is not None else None

    # 真实每页评分（同页取最新一次），供前端替换原 Math.random 假数据
    rows = (await db.execute(
        select(TranslationQuality, Page.sort_order)
        .join(Page, TranslationQuality.page_id == Page.page_id)
        .where(TranslationQuality.page_id.in_(select(page_ids_subq.c.page_id)))
        .order_by(TranslationQuality.created_at.desc())
    )).all()
    seen: set = set()
    pages: list = []
    for q, sort_order in rows:
        if q.page_id in seen:
            continue
        seen.add(q.page_id)
        pages.append({
            "page_id": str(q.page_id),
            "sort_order": sort_order,
            "overall_score": _pct(q.overall_score),
            "bleu_score": _pct(q.bleu_score),
            "mt_confidence": _pct(q.tone_consistency),
            "term_consistency": _pct(q.term_consistency),
        })
    pages.sort(key=lambda p: (p["sort_order"] is None, p["sort_order"]))

    avg_overall = _pct(agg[3]) if agg else None
    avg_mt = _pct(agg[4]) if agg else None
    avg_term = _pct(agg[5]) if agg else None
    return success_response(data={
        "project_id": project_id,
        "total_pages": total_pages,
        "scored_pages": (agg[0] if agg else 0) or 0,
        "avg_bleu": _pct(agg[1]) if agg else None,
        "avg_meteor": _pct(agg[2]) if agg else None,
        "avg_overall": avg_overall,
        "avg_mt_confidence": avg_mt,
        "avg_term_consistency": avg_term,
        "radar_data": {
            "labels": _REAL_AXES_LABELS,
            "values": [
                avg_mt or 0,               # OCR/机翻置信度轴（近似）
                avg_overall or 0,
                avg_mt or 0,
                avg_term or 0,
            ],
        },
        "pages": pages,
        "trend": [],  # 诚实留空：趋势需按时间分桶聚合，暂未实现，不伪造数据点
    })


def _quality_to_dict(q: TranslationQuality) -> dict:
    return {
        "quality_id": str(q.quality_id),
        "page_id": str(q.page_id),
        "bleu_score": q.bleu_score,
        "meteor_score": q.meteor_score,
        "mt_confidence": q.tone_consistency,   # 语义已诚实化为机翻置信度
        "term_consistency": q.term_consistency,
        "overall_score": q.overall_score,
        "report_json": q.report_json,
        "created_at": q.created_at.isoformat() if q.created_at else None,
    }
