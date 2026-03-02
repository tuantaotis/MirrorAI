"""
MirrorAI — ChromaDB Vector Indexer.
Store, upsert, and manage embeddings in ChromaDB.
"""

import logging
import os
from typing import Optional

import chromadb

from ..data_pipeline.chunker import Chunk
from .embedder import BaseEmbedder, create_embedder

logger = logging.getLogger("mirrorai.indexer")


class VectorIndexer:
    """Manages ChromaDB collection for MirrorAI embeddings."""

    def __init__(
        self,
        collection_name: str = "user_messages",
        chromadb_url: str | None = None,
        embedder: BaseEmbedder | None = None,
    ):
        url = chromadb_url or os.getenv("CHROMADB_URL", "http://localhost:8000")
        self.client = chromadb.HttpClient(host=url.split("://")[-1].split(":")[0],
                                          port=int(url.split(":")[-1]))
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )
        self.embedder = embedder or create_embedder()
        logger.info(
            f"[VectorIndexer] collection={collection_name}, "
            f"existing={self.collection.count()} vectors"
        )

    def index_chunks(self, chunks: list[Chunk], batch_size: int = 100) -> int:
        """Embed and upsert chunks into ChromaDB. Returns number indexed."""
        total = 0

        for i in range(0, len(chunks), batch_size):
            batch = chunks[i : i + batch_size]
            texts = [c.text for c in batch]
            ids = [c.id for c in batch]
            metadatas = [c.metadata for c in batch]

            # Embed
            embeddings = self.embedder.embed(texts)

            # Upsert
            self.collection.upsert(
                ids=ids,
                documents=texts,
                embeddings=embeddings,
                metadatas=metadatas,
            )

            total += len(batch)
            logger.info(f"[VectorIndexer] Indexed {total}/{len(chunks)} chunks")

        return total

    def search(
        self,
        query: str,
        n_results: int = 5,
        where: Optional[dict] = None,
    ) -> list[dict]:
        """Semantic search: returns top-N similar chunks."""
        query_embedding = self.embedder.embed_single(query)

        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where=where,
            include=["documents", "metadatas", "distances"],
        )

        output = []
        if results["documents"] and results["documents"][0]:
            for j in range(len(results["documents"][0])):
                output.append({
                    "text": results["documents"][0][j],
                    "metadata": results["metadatas"][0][j] if results["metadatas"] else {},
                    "distance": results["distances"][0][j] if results["distances"] else 0,
                    "id": results["ids"][0][j] if results["ids"] else "",
                })

        return output

    def count(self) -> int:
        """Return total vectors in collection."""
        return self.collection.count()

    def delete_collection(self) -> None:
        """Delete entire collection (use with caution)."""
        self.client.delete_collection(self.collection.name)
        logger.warning(f"[VectorIndexer] Deleted collection: {self.collection.name}")
