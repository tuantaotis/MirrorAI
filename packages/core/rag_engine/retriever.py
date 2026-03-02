"""
MirrorAI — RAG Retriever.
Semantic search + optional reranking for context retrieval.
"""

import logging
from dataclasses import dataclass

from .indexer import VectorIndexer

logger = logging.getLogger("mirrorai.retriever")


@dataclass
class RetrievedContext:
    text: str
    distance: float
    metadata: dict
    relevance_score: float  # 1 - distance (for cosine)


class Retriever:
    """Retrieve relevant past messages for RAG context."""

    def __init__(self, indexer: VectorIndexer, top_k: int = 5):
        self.indexer = indexer
        self.top_k = top_k

    def retrieve(
        self,
        query: str,
        conversation_history: str = "",
        top_k: int | None = None,
    ) -> list[RetrievedContext]:
        """
        Retrieve relevant context for a query.
        Enriches query with conversation history for better semantic matching.
        """
        k = top_k or self.top_k

        # Enrich query with recent conversation context
        enriched_query = query
        if conversation_history:
            # Append last part of conversation for context
            history_tail = conversation_history[-500:]  # Last ~500 chars
            enriched_query = f"{history_tail}\n{query}"

        # Search
        results = self.indexer.search(enriched_query, n_results=k)

        # Convert to RetrievedContext
        contexts = []
        for r in results:
            contexts.append(
                RetrievedContext(
                    text=r["text"],
                    distance=r["distance"],
                    metadata=r["metadata"],
                    relevance_score=max(0.0, 1.0 - r["distance"]),
                )
            )

        if contexts:
            logger.info(
                f"[Retriever] Query: '{query[:50]}...' → "
                f"{len(contexts)} results, "
                f"best score: {contexts[0].relevance_score:.3f}"
            )
        else:
            logger.info(f"[Retriever] Query: '{query[:50]}...' → no results")
        return contexts

    def get_confidence(self, contexts: list[RetrievedContext]) -> float:
        """
        Calculate confidence score based on retrieval results.
        Higher = more confident the AI can respond accurately.
        """
        if not contexts:
            return 0.0

        # Weighted average: top result matters most
        weights = [0.4, 0.25, 0.15, 0.1, 0.1]
        score = 0.0
        for i, ctx in enumerate(contexts[: len(weights)]):
            score += ctx.relevance_score * weights[i]

        return min(1.0, score)
