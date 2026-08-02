import unittest

from scripts.query_reliability_rag_corpus import search_chunks, tokenize


class ReliabilityRagQueryTests(unittest.TestCase):
    def test_tokenize_removes_stopwords(self):
        self.assertEqual(tokenize("The FRACAS corrective action"), ["fracas", "corrective", "action"])

    def test_search_chunks_returns_ranked_source_metadata(self):
        chunks = [
            {
                "chunk_id": "a-0001",
                "source_id": "mil-hdbk-338b",
                "title": "MIL-HDBK-338B",
                "document_type": "military-handbook",
                "domain_tags": ["FRACAS", "RAM"],
                "page_start": 10,
                "page_end": 11,
                "text": "FRACAS collects failure data, analyzes root cause, and tracks corrective action.",
            },
            {
                "chunk_id": "b-0001",
                "source_id": "other",
                "title": "Other",
                "document_type": "report",
                "domain_tags": [],
                "page_start": 1,
                "page_end": 1,
                "text": "A general project management summary.",
            },
        ]

        results = search_chunks(chunks, "FRACAS corrective action", limit=1)

        self.assertEqual(results[0]["chunk_id"], "a-0001")
        self.assertEqual(results[0]["page_start"], 10)
        self.assertIn("corrective action", results[0]["excerpt"])


if __name__ == "__main__":
    unittest.main()
