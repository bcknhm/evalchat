"""
Custom RAGAS-style evaluation metrics implemented via direct LLM calls.

Metrics:
  - faithfulness:       Are all answer statements supported by the retrieved context?
  - answer_relevancy:   Does the answer address the question? (cosine sim of reverse questions)
  - context_precision:  Are the retrieved chunks relevant to the question? (weighted precision)
  - context_recall:     Does the context contain all info needed? (via synthetic ground truth)
"""

import json
import logging
import numpy as np
from typing import List
from openai import AsyncOpenAI

from .config import settings

logger = logging.getLogger(__name__)
_async_client = None


def _get_client() -> AsyncOpenAI:
    global _async_client
    if _async_client is None:
        _async_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _async_client


async def _llm(prompt: str, model: str, temperature: float = 0.0) -> str:
    client = _get_client()
    resp = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
    )
    return resp.choices[0].message.content.strip()


def _parse_json_list(text: str) -> list:
    """Robustly parse a JSON array from LLM output."""
    text = text.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1]) if len(lines) > 2 else text
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
    except json.JSONDecodeError:
        pass
    # Try to find JSON array in text
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    return []


# ---------------------------------------------------------------------------
# Faithfulness
# ---------------------------------------------------------------------------

async def compute_faithfulness(
    question: str, answer: str, contexts: List[str], model: str
) -> float:
    """Score: fraction of answer statements supported by context."""
    context_str = "\n\n---\n\n".join(contexts)

    # Step 1: extract statements
    stmt_prompt = f"""Extract all individual factual statements from the answer below.
Return ONLY a JSON array of strings, one statement per element.

Answer:
{answer}"""

    try:
        raw = await _llm(stmt_prompt, model)
        statements = _parse_json_list(raw)
    except Exception as e:
        logger.warning(f"faithfulness extract failed: {e}")
        return 0.5

    if not statements:
        return 1.0

    # Step 2: verify each statement against context
    verify_prompt = f"""Context:
{context_str}

For each statement, answer "yes" if the context supports it, "no" otherwise.
Return ONLY a JSON array of "yes"/"no" strings in the same order as the statements.

Statements:
{json.dumps(statements, ensure_ascii=False)}"""

    try:
        raw = await _llm(verify_prompt, model)
        verdicts = _parse_json_list(raw)
        supported = sum(1 for v in verdicts if str(v).lower() in ("yes", "true", "1", "ja"))
        return round(supported / len(statements), 3)
    except Exception as e:
        logger.warning(f"faithfulness verify failed: {e}")
        return 0.5


# ---------------------------------------------------------------------------
# Answer Relevancy
# ---------------------------------------------------------------------------

async def compute_answer_relevancy(
    question: str, answer: str, model: str
) -> float:
    """Score: mean cosine similarity between original question and reverse questions."""
    gen_prompt = f"""Given the following answer, generate exactly 3 different questions that this answer could be responding to.
Return ONLY a JSON array of exactly 3 question strings.

Answer:
{answer}"""

    try:
        raw = await _llm(gen_prompt, model, temperature=0.3)
        generated = _parse_json_list(raw)
        if not generated:
            return 0.5
        generated = [str(q) for q in generated[:3]]
    except Exception as e:
        logger.warning(f"answer_relevancy gen failed: {e}")
        return 0.5

    all_questions = [question] + generated
    try:
        client = _get_client()
        resp = await client.embeddings.create(
            model="text-embedding-3-small",
            input=all_questions,
        )
        embeddings = [np.array(e.embedding) for e in resp.data]
        orig = embeddings[0]
        sims = [
            float(np.dot(orig, g) / (np.linalg.norm(orig) * np.linalg.norm(g) + 1e-10))
            for g in embeddings[1:]
        ]
        return round(float(np.mean(sims)), 3)
    except Exception as e:
        logger.warning(f"answer_relevancy embed failed: {e}")
        return 0.5


# ---------------------------------------------------------------------------
# Context Precision
# ---------------------------------------------------------------------------

async def compute_context_precision(
    question: str, contexts: List[str], model: str
) -> float:
    """Score: weighted precision – relevant chunks ranked first score higher."""
    if not contexts:
        return 0.0

    verdicts: List[int] = []
    for ctx in contexts:
        prompt = f"""Is the following context chunk useful for answering the question?
Answer only "yes" or "no".

Question: {question}

Context chunk:
{ctx[:600]}"""
        try:
            raw = await _llm(prompt, model)
            verdicts.append(1 if "yes" in raw.lower() else 0)
        except Exception:
            verdicts.append(0)

    # Weighted precision at k (standard RAGAS formula)
    relevant_count = 0
    precision_at_k_sum = 0.0
    for k, v in enumerate(verdicts, 1):
        if v == 1:
            relevant_count += 1
            precision_at_k_sum += relevant_count / k

    if relevant_count == 0:
        return 0.0
    return round(precision_at_k_sum / relevant_count, 3)


# ---------------------------------------------------------------------------
# Context Recall  (synthetic ground truth)
# ---------------------------------------------------------------------------

async def compute_context_recall(
    question: str, contexts: List[str], model: str
) -> float:
    """
    Score: fraction of ground-truth claims covered by retrieved context.
    Ground truth is generated synthetically via a second LLM call.
    """
    context_str = "\n\n---\n\n".join(contexts)

    # Step 1: Generate ideal ground-truth answer from full context
    gt_prompt = f"""Using ONLY the information in the context below, write a comprehensive, complete answer to the question.
Include every relevant detail from the context.

Context:
{context_str}

Question: {question}

Comprehensive answer:"""

    try:
        ground_truth = await _llm(gt_prompt, model)
    except Exception as e:
        logger.warning(f"context_recall GT gen failed: {e}")
        return 0.5

    # Step 2: Extract claims from ground truth
    claims_prompt = f"""Extract all individual factual claims from the text below.
Return ONLY a JSON array of strings (max 12 claims).

Text:
{ground_truth}"""

    try:
        raw = await _llm(claims_prompt, model)
        claims = _parse_json_list(raw)[:12]
    except Exception as e:
        logger.warning(f"context_recall claims failed: {e}")
        return 0.5

    if not claims:
        return 1.0

    # Step 3: Check each claim against retrieved context
    check_prompt = f"""Context:
{context_str}

For each claim, answer "yes" if the context supports it, "no" otherwise.
Return ONLY a JSON array of "yes"/"no" strings in the same order.

Claims:
{json.dumps(claims, ensure_ascii=False)}"""

    try:
        raw = await _llm(check_prompt, model)
        verdicts = _parse_json_list(raw)
        covered = sum(1 for v in verdicts if str(v).lower() in ("yes", "true", "1", "ja"))
        return round(covered / len(claims), 3)
    except Exception as e:
        logger.warning(f"context_recall check failed: {e}")
        return 0.5


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def run_evaluation(
    question: str,
    answer: str,
    contexts: List[str],
    eval_model: str,
) -> dict:
    """Run all four metrics concurrently and return scores dict."""
    import asyncio

    faithfulness, relevancy, precision, recall = await asyncio.gather(
        compute_faithfulness(question, answer, contexts, eval_model),
        compute_answer_relevancy(question, answer, eval_model),
        compute_context_precision(question, contexts, eval_model),
        compute_context_recall(question, contexts, eval_model),
    )

    return {
        "faithfulness": faithfulness,
        "answer_relevancy": relevancy,
        "context_precision": precision,
        "context_recall": recall,
    }
