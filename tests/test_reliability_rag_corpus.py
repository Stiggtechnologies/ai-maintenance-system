import tempfile
import unittest
from pathlib import Path

from scripts.reliability_rag_corpus import (
    chunk_pages,
    infer_source,
    normalize_text,
    PageRecord,
)


class ReliabilityRagCorpusTests(unittest.TestCase):
    def test_normalize_text_removes_noise_without_flattening_paragraphs(self):
        text = normalize_text("Alpha\t beta\n\n\nGamma\x00")

        self.assertEqual(text, "Alpha beta\n\nGamma")

    def test_infer_source_deduplicates_known_handbook_identity(self):
        source = infer_source(Path("/tmp/MILHDBK338B (1).pdf"))

        self.assertEqual(source.source_id, "mil-hdbk-338b")
        self.assertIn("FRACAS", source.domain_tags)

    def test_infer_source_identifies_mil_hdbk_217f(self):
        source = infer_source(Path("/tmp/MIL-HDBK-217F.pdf"))

        self.assertEqual(source.source_id, "mil-hdbk-217f")
        self.assertEqual(
            source.title,
            "MIL-HDBK-217F Reliability Prediction of Electronic Equipment",
        )
        self.assertIn("part-stress", source.domain_tags)

    def test_infer_source_identifies_nswc_mechanical_handbook(self):
        source = infer_source(
            Path(
                "/tmp/Handbook_of_Reliability_Prediction_Procedures_for_Mechanical_Equipment_NSWC-11.pdf"
            )
        )

        self.assertEqual(source.source_id, "nswc-11-mechanical")
        self.assertEqual(
            source.title,
            "NSWC-11 Handbook of Reliability Prediction Procedures for Mechanical Equipment",
        )
        self.assertEqual(source.document_type, "mechanical-reliability-handbook")
        self.assertIn("mechanical-equipment", source.domain_tags)
        self.assertIn("bearings", source.domain_tags)

    def test_chunk_pages_keeps_source_and_page_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = infer_source(Path(tmp) / "MILHDBK338B.pdf")
            pages = [
                PageRecord(
                    source_id=source.source_id,
                    title=source.title,
                    source_path=str(source.path),
                    sha256="abc",
                    page_number=1,
                    text=" ".join(f"word{i}" for i in range(80)),
                    char_count=500,
                    word_count=80,
                ),
                PageRecord(
                    source_id=source.source_id,
                    title=source.title,
                    source_path=str(source.path),
                    sha256="abc",
                    page_number=2,
                    text=" ".join(f"next{i}" for i in range(80)),
                    char_count=500,
                    word_count=80,
                ),
            ]

            chunks = chunk_pages(
                source=source,
                sha256="abc",
                pages=pages,
                chunk_words=100,
                overlap_words=10,
            )

        self.assertGreaterEqual(len(chunks), 2)
        self.assertEqual(chunks[0].source_id, "mil-hdbk-338b")
        self.assertEqual(chunks[0].page_start, 1)
        self.assertEqual(chunks[0].page_end, 2)
        self.assertLessEqual(chunks[0].word_count, 100)


if __name__ == "__main__":
    unittest.main()
