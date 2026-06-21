

```
                User Query
                     |
                     v
            Query Planning Agent
                     |
     --------------------------------
     |              |               |
     v              v               v

Collector A    Collector B    Collector C
Semantic       Citation        Web Search
Search         Expansion       Expansion

     |              |               |
     --------------------------------
                     |
                     v

          Research Paper Store
         (Metadata + Full Text)

                     |
                     v

              Vector DB
              (Pinecone)

                     |
                     v

             Critic Agent
         (Gap Detection /
          Hallucination Check)

                     |
                     v

             Final Report
```             



```
structure:

data/
├── metadata/
│   └── papers.json
├── abstracts/
│   └── paper_id.txt
├── pdfs/
│   └── paper_id.pdf
└── processed/
    └── chunks.json


Store:

Title
Authors
Abstract
Categories
Published date
arXiv ID
PDF URL
Citation URL
Local PDF path

```
we use pincone to store text based data also text the workflo and connections 
Create Pinecone Index

The embedding model all-MiniLM-L6-v2 produces 384-dimensional vectors.

```python

from pinecone import Pinecone, ServerlessSpec

pc = Pinecone(api_key="YOUR_PINECONE_API_KEY")

index_name = "research-db"

if index_name not in [i["name"] for i in pc.list_indexes()]:
    pc.create_index(
        name=index_name,
        dimension=384,
        metric="cosine",
        spec=ServerlessSpec(
            cloud="aws",
            region="us-east-1"
        )
    )

print("Index ready")
```

Best embeding models recomended 

| Model                                    | Dimension | Quality                       |
| ---------------------------------------- | --------- | ----------------------------- |
| `sentence-transformers/all-MiniLM-L6-v2` | 384       | Fast, lightweight             |
| `BAAI/bge-small-en-v1.5`                 | 384       | Better retrieval              |
| `BAAI/bge-base-en-v1.5`                  | 768       | Strong retrieval              |
| `intfloat/e5-base-v2`                    | 768       | Excellent for semantic search |
| `BAAI/bge-large-en-v1.5`                 | 1024      | Near production-grade RAG     |



Full catalog loaded at startup

At import time, every *_papers.json in data/metadata/ is read and deduplicated into PAPER_CATALOG (a Python list of 30 papers in your case).
get_catalog_summary() returns a numbered list [1] "Title" — Authors (Year) that gets injected into every system prompt, so the LLM always knows all 30 papers exist.

Hybrid search (Dense + BM25 + RRF)

Dense: BGE embeddings → Pinecone (up to 60 candidates)
Sparse: BM25 scoring over those candidates
Merged via Reciprocal Rank Fusion — neither method dominates, both contribute
Result: much better recall for keyword-heavy queries like author names, years, specific terms

run.py
Smart routing node — before any vector search, the agent routes the question:

"how many papers" / "list all" / "paper 29" → catalog_node (instant answer from memory, no Pinecone call)
Everything else → retrieve → rerank → generate