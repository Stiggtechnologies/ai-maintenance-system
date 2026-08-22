#!/usr/bin/env python3
"""Query a generated reliability RAG corpus with local lexical retrieval.

This is a validation tool, not the production retriever. It proves the extracted
chunks are usable before embeddings are generated and loaded into Azure AI
Search, pgvector, Qdrant, or another vector store.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any


STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "with",
}


def tokenize(text: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-z0-9]+", text.lower())
        if len(token) > 2 and token not in STOPWORDS
    ]


def load_chunks(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as file:
        return [json.loads(line) for line in file if line.strip()]


def excerpt(text: str, query_terms: set[str], max_chars: int = 420) -> str:
    lower_text = text.lower()
    first_hit = min(
        (lower_text.find(term) for term in query_terms if lower_text.find(term) >= 0),
        default=0,
    )
    start = max(0, first_hit - max_chars // 3)
    end = min(len(text), start + max_chars)
    snippet = text[start:end].strip()
    if start > 0:
        snippet = f"...{snippet}"
    if end < len(text):
        snippet = f"{snippet}..."
    return snippet


def search_chunks(
    chunks: list[dict[str, Any]],
    query: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    query_terms = tokenize(query)
    if not query_terms:
        return []

    document_frequency: Counter[str] = Counter()
    chunk_tokens: list[list[str]] = []
    for chunk in chunks:
        tokens = tokenize(chunk.get("text", ""))
        chunk_tokens.append(tokens)
        document_frequency.update(set(tokens))

    query_counts = Counter(query_terms)
    total_chunks = len(chunks)
    scored: list[dict[str, Any]] = []

    for chunk, tokens in zip(chunks, chunk_tokens):
        token_counts = Counter(tokens)
        score = 0.0
        for term, query_count in query_counts.items():
            if term not in token_counts:
                continue
            idf = math.log((total_chunks + 1) / (document_frequency[term] + 1)) + 1
            score += (1 + math.log(token_counts[term])) * idf * query_count

        haystacks = [
            chunk.get("title", ""),
            chunk.get("document_type", ""),
            " ".join(chunk.get("domain_tags", [])),
        ]
        metadata_text = " ".join(haystacks).lower()
        score += sum(0.75 for term in query_counts if term in metadata_text)

        if score <= 0:
            continue

        scored.append(
            {
                "chunk_id": chunk["chunk_id"],
                "source_id": chunk["source_id"],
                "title": chunk["title"],
                "page_start": chunk["page_start"],
                "page_end": chunk["page_end"],
                "score": round(score, 4),
                "excerpt": excerpt(chunk.get("text", ""), set(query_terms)),
            }
        )

    return sorted(scored, key=lambda result: result["score"], reverse=True)[:limit]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="Search query")
    parser.add_argument(
        "--corpus",
        type=Path,
        default=Path("rag-corpus/reliability/chunks.jsonl"),
        help="Path to chunks.jsonl",
    )
    parser.add_argument("--limit", type=int, default=5)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    chunks = load_chunks(args.corpus)
    results = search_chunks(chunks, args.query, limit=args.limit)
    print(json.dumps({"query": args.query, "results": results}, indent=2))


if __name__ == "__main__":
    main()
