#!/usr/bin/env python3
"""Build a page-aware RAG corpus from reliability PDF sources.

The output is intentionally vector-database agnostic:

- `manifest.json` summarizes source documents and chunk counts.
- `sources.json` contains source-level metadata.
- `pages.jsonl` contains page-level extracted text.
- `chunks.jsonl` contains retrieval-ready chunks with source/page metadata.

Embeddings are deliberately not generated here. This keeps the corpus build
repeatable without requiring OpenAI/Azure credentials and lets the application
choose its vector store later.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from pypdf import PdfReader


DEFAULT_CHUNK_WORDS = 850
DEFAULT_OVERLAP_WORDS = 120


@dataclass(frozen=True)
class SourceSpec:
    path: Path
    source_id: str
    title: str
    document_type: str
    rights: str
    domain_tags: list[str]


@dataclass
class PageRecord:
    source_id: str
    title: str
    source_path: str
    sha256: str
    page_number: int
    text: str
    char_count: int
    word_count: int


@dataclass
class ChunkRecord:
    chunk_id: str
    source_id: str
    title: str
    document_type: str
    rights: str
    source_path: str
    sha256: str
    page_start: int
    page_end: int
    chunk_index: int
    domain_tags: list[str]
    text: str
    char_count: int
    word_count: int


def normalize_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "source"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", text))


def extract_pages(source: SourceSpec, sha256: str) -> list[PageRecord]:
    reader = PdfReader(str(source.path))
    pages: list[PageRecord] = []

    for index, page in enumerate(reader.pages, start=1):
        text = normalize_text(page.extract_text() or "")
        pages.append(
            PageRecord(
                source_id=source.source_id,
                title=source.title,
                source_path=str(source.path),
                sha256=sha256,
                page_number=index,
                text=text,
                char_count=len(text),
                word_count=word_count(text),
            )
        )

    return pages


def chunk_pages(
    source: SourceSpec,
    sha256: str,
    pages: list[PageRecord],
    chunk_words: int,
    overlap_words: int,
) -> list[ChunkRecord]:
    chunks: list[ChunkRecord] = []
    current_words: list[str] = []
    current_start_page: int | None = None
    current_end_page: int | None = None
    chunk_index = 0

    def flush() -> None:
        nonlocal current_words, current_start_page, current_end_page, chunk_index
        if not current_words or current_start_page is None or current_end_page is None:
            return

        text = " ".join(current_words).strip()
        if text:
            chunks.append(
                ChunkRecord(
                    chunk_id=f"{source.source_id}-{chunk_index:04d}",
                    source_id=source.source_id,
                    title=source.title,
                    document_type=source.document_type,
                    rights=source.rights,
                    source_path=str(source.path),
                    sha256=sha256,
                    page_start=current_start_page,
                    page_end=current_end_page,
                    chunk_index=chunk_index,
                    domain_tags=source.domain_tags,
                    text=text,
                    char_count=len(text),
                    word_count=len(current_words),
                )
            )
            chunk_index += 1

        current_words = current_words[-overlap_words:] if overlap_words else []
        current_start_page = current_end_page if current_words else None

    for page in pages:
        words = re.findall(r"\S+", page.text)
        if not words:
            continue
        if current_start_page is None:
            current_start_page = page.page_number

        cursor = 0
        while cursor < len(words):
            remaining = chunk_words - len(current_words)
            current_words.extend(words[cursor : cursor + remaining])
            current_end_page = page.page_number
            cursor += remaining
            if len(current_words) >= chunk_words:
                flush()

    flush()
    return chunks


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_jsonl(path: Path, records: Iterable[object]) -> int:
    count = 0
    with path.open("w", encoding="utf-8") as file:
        for record in records:
            file.write(json.dumps(record, ensure_ascii=False) + "\n")
            count += 1
    return count


def infer_source(path: Path) -> SourceSpec:
    name = path.name
    stem = path.stem.replace(" (1)", "")
    lower = name.lower()

    if "milhdbk338b" in lower:
        return SourceSpec(
            path=path,
            source_id="mil-hdbk-338b",
            title="MIL-HDBK-338B Electronic Reliability Design Handbook",
            document_type="military-handbook",
            rights="Public-domain U.S. government handbook; verify redistribution policy before commercial packaging.",
            domain_tags=["RAM", "FRACAS", "reliability-prediction", "maintainability", "statistical-analysis"],
        )
    if "mil-hdbk-217f" in lower or "milhdbk217f" in lower:
        return SourceSpec(
            path=path,
            source_id="mil-hdbk-217f",
            title="MIL-HDBK-217F Reliability Prediction of Electronic Equipment",
            document_type="military-handbook",
            rights="Public-domain U.S. government handbook; verify redistribution policy before commercial packaging.",
            domain_tags=[
                "reliability-prediction",
                "electronic-equipment",
                "failure-rates",
                "part-stress",
                "parts-count",
                "environmental-factors",
            ],
        )
    if "nswc-11" in lower or (
        "reliability_prediction_procedures_for_mechanical_equipment" in lower
    ):
        return SourceSpec(
            path=path,
            source_id="nswc-11-mechanical",
            title="NSWC-11 Handbook of Reliability Prediction Procedures for Mechanical Equipment",
            document_type="mechanical-reliability-handbook",
            rights="Public U.S. government handbook; verify redistribution policy before commercial packaging.",
            domain_tags=[
                "reliability-prediction",
                "mechanical-equipment",
                "failure-rates",
                "bearings",
                "gears",
                "seals",
                "springs",
                "brakes",
                "clutches",
                "pumps",
                "valves",
            ],
        )
    if "dod reliability availability and maintainability" in lower:
        return SourceSpec(
            path=path,
            source_id="dod-ram-guide",
            title="DoD Reliability, Availability, and Maintainability Guide",
            document_type="guidance",
            rights="Public U.S. government guidance; verify redistribution policy before commercial packaging.",
            domain_tags=["RAM", "program-governance", "requirements", "test-and-evaluation"],
        )
    if "radc-tr-85-194" in lower:
        return SourceSpec(
            path=path,
            source_id="radc-tr-85-194",
            title="RADC-TR-85-194 Nonelectronic Parts Reliability Data",
            document_type="technical-report",
            rights="Public technical report; verify redistribution policy before commercial packaging.",
            domain_tags=["reliability-data", "nonelectronic-parts", "failure-rates", "prediction"],
        )
    if "failure-investigation-report" in lower or "tc-oil" in lower:
        return SourceSpec(
            path=path,
            source_id="tc-oil-nd-2017-failure-investigation",
            title="Failure Investigation Report - TC Oil North Dakota 2017",
            document_type="failure-investigation-report",
            rights="User-supplied local PDF; confirm commercial redistribution rights before bundling.",
            domain_tags=["RCA", "failure-investigation", "pipeline", "evidence-analysis"],
        )

    return SourceSpec(
        path=path,
        source_id=slugify(stem),
        title=stem,
        document_type="source-document",
        rights="User-supplied local PDF; confirm commercial redistribution rights before bundling.",
        domain_tags=["reliability"],
    )


def build_corpus(
    pdf_paths: list[Path],
    output_dir: Path,
    chunk_words: int,
    overlap_words: int,
) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)

    seen_hashes: dict[str, str] = {}
    sources: list[dict[str, object]] = []
    page_records: list[PageRecord] = []
    chunk_records: list[ChunkRecord] = []
    skipped_duplicates: list[dict[str, str]] = []

    for pdf_path in pdf_paths:
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        source = infer_source(pdf_path)
        digest = sha256_file(pdf_path)
        if digest in seen_hashes:
            skipped_duplicates.append(
                {
                    "path": str(pdf_path),
                    "duplicate_of_source_id": seen_hashes[digest],
                    "sha256": digest,
                }
            )
            continue

        seen_hashes[digest] = source.source_id
        pages = extract_pages(source, digest)
        chunks = chunk_pages(source, digest, pages, chunk_words, overlap_words)

        extracted_words = sum(page.word_count for page in pages)
        empty_pages = sum(1 for page in pages if page.word_count == 0)

        sources.append(
            {
                **asdict(source),
                "path": str(source.path),
                "sha256": digest,
                "page_count": len(pages),
                "empty_pages": empty_pages,
                "word_count": extracted_words,
                "chunk_count": len(chunks),
            }
        )
        page_records.extend(pages)
        chunk_records.extend(chunks)

    sources_path = output_dir / "sources.json"
    pages_path = output_dir / "pages.jsonl"
    chunks_path = output_dir / "chunks.jsonl"
    manifest_path = output_dir / "manifest.json"

    write_json(sources_path, sources)
    page_count = write_jsonl(pages_path, (asdict(page) for page in page_records))
    chunk_count = write_jsonl(chunks_path, (asdict(chunk) for chunk in chunk_records))

    manifest = {
        "corpus_id": "syncai-reliability-seed-corpus",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "chunk_words": chunk_words,
        "overlap_words": overlap_words,
        "source_count": len(sources),
        "duplicate_count": len(skipped_duplicates),
        "page_count": page_count,
        "chunk_count": chunk_count,
        "total_words": sum(source["word_count"] for source in sources),
        "files": {
            "sources": str(sources_path),
            "pages": str(pages_path),
            "chunks": str(chunks_path),
        },
        "skipped_duplicates": skipped_duplicates,
        "notes": [
            "Embeddings are not generated by this script.",
            "Use chunks.jsonl as the input for Azure AI Search, pgvector, Qdrant, or another vector index.",
            "Confirm redistribution rights before packaging source text into a commercial default knowledge base.",
        ],
    }

    write_json(manifest_path, manifest)
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdfs", nargs="+", type=Path, help="PDF files to ingest")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("rag-corpus/reliability"),
        help="Output directory for manifest, sources, pages, and chunks",
    )
    parser.add_argument(
        "--chunk-words",
        type=int,
        default=DEFAULT_CHUNK_WORDS,
        help="Approximate words per chunk",
    )
    parser.add_argument(
        "--overlap-words",
        type=int,
        default=DEFAULT_OVERLAP_WORDS,
        help="Approximate word overlap between chunks",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.overlap_words >= args.chunk_words:
        raise ValueError("overlap-words must be smaller than chunk-words")

    manifest = build_corpus(
        pdf_paths=args.pdfs,
        output_dir=args.output,
        chunk_words=args.chunk_words,
        overlap_words=args.overlap_words,
    )
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
