![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-Database-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Pinecone](https://img.shields.io/badge/Pinecone-Vector_DB-000000?style=for-the-badge)
![LangGraph](https://img.shields.io/badge/LangGraph-Agent_Framework-1E293B?style=for-the-badge)
![Qwen2.5](https://img.shields.io/badge/Qwen2.5-7B_Instruct-7C3AED?style=for-the-badge)
![BGE](https://img.shields.io/badge/BGE-Embeddings-2563EB?style=for-the-badge)
![CrossEncoder](https://img.shields.io/badge/Cross_Encoder-Reranker-DC2626?style=for-the-badge)
![PyMuPDF](https://img.shields.io/badge/PyMuPDF-PDF_Processing-F59E0B?style=for-the-badge)
![RAG](https://img.shields.io/badge/RAG-Pipeline-10B981?style=for-the-badge)
![VLM](https://img.shields.io/badge/VLM-Research_Assistant-8B5CF6?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-success?style=for-the-badge)

Autonomous AI Research Agent for exploring, indexing, retrieving, and reasoning over academic papers using Retrieval-Augmented Generation (RAG).

# Aclyon Research Agent

## Overview

Aclyon is an autonomous AI research agent designed to help users explore, understand, and interact with academic papers through a modern research workspace. Instead of manually searching through documents, users can ask natural language questions and receive grounded answers generated from relevant research papers.

The platform combines semantic retrieval, reranking, and large language model reasoning to create an end-to-end research assistant capable of summarization, comparison, explanation, and literature exploration. Aclyon is built as App 3 within the Montage V7 ecosystem and focuses on Vision-Language Model (VLM) research papers.

## Key Features

* Personal research paper library
* PDF upload and management
* In-browser PDF viewer
* Semantic search using Pinecone
* Hybrid retrieval (Dense + Sparse Search)
* Cross-Encoder reranking
* Retrieval-Augmented Generation (RAG)
* AI-powered research assistant
* Session-based authentication
* FastAPI backend with SQLite storage

## System Architecture

Aclyon follows a Retrieval-Augmented Generation (RAG) architecture. Research papers are processed through an ingestion pipeline where text is extracted, chunked, embedded using BGE Base v1.5, and stored in Pinecone. When a user submits a query, the system retrieves relevant chunks, reranks them using a Cross-Encoder model, and generates a grounded response using Qwen2.5-7B-Instruct.

The frontend is built using HTML, CSS, and JavaScript, while FastAPI serves as the backend framework. SQLite manages metadata and user information, and Pinecone provides scalable vector search capabilities.




## AI Pipeline

| Component            | Purpose                              |
| -------------------- | ------------------------------------ |
| BGE Base v1.5        | Generate semantic embeddings         |
| Pinecone             | Store and retrieve vector embeddings |
| Hybrid Search        | Dense + Sparse retrieval             |
| Cross-Encoder MiniLM | Rerank retrieved passages            |
| Qwen2.5-7B-Instruct  | Generate final grounded answers      |
| LangGraph            | Agent orchestration and routing      |

## Research Workflow

1. User selects or uploads a research paper.
2. Paper content is indexed and stored in Pinecone.
3. User asks a question through the Aclyon interface.
4. The agent retrieves relevant evidence. 
5. Retrieved passages are reranked using a Cross-Encoder.
6. Qwen2.5-7B-Instruct generates a contextual response.
7. The answer is returned to the user with supporting evidence.

## Technology Stack

| Layer           | Technology                          |
| --------------- | ----------------------------------- |
| Frontend        | HTML, CSS, JavaScript               |
| Backend         | FastAPI                             |
| Database        | SQLite                              |
| Vector Database | Pinecone                            |
| Embedding Model | BAAI/bge-base-en-v1.5               |
| Reranker        | cross-encoder/ms-marco-MiniLM-L6-v2 |
| LLM             | Qwen2.5-7B-Instruct                 |
| Agent Framework | LangGraph                           |
| PDF Processing  | PyMuPDF                             |

## Installation

### Create Virtual Environment

```bash
python -m venv venv
```

### Activate Environment

Windows:

```bash
venv\Scripts\activate
```

Linux / macOS:

```bash
source venv/bin/activate
```

### Install Dependencies

```bash
pip install -r requirements.txt
```

### Configure Environment Variables

Create a `.env` file and add:

```env
PINECONE_API_KEY=your_key
HF_TOKEN=your_token
```

### Run Application

```bash
python -m uvicorn src.Main.run:app --port 8000
```

### Open Browser

```text
http://localhost:8000
```

## Future Improvements

* Automatic paper collection from research topics
* Per-user vector databases
* Streaming AI responses
* Conversation memory
* Cross-paper comparison mode
* Background indexing jobs
* Citation deep-linking
* Advanced analytics dashboard

## Conclusion

Aclyon transforms a traditional paper library into an autonomous research environment by combining vector search, retrieval augmentation, and large language models. The system enables researchers to interact with academic literature through natural language while the agent handles retrieval, reasoning, and synthesis automatically.    in the upperside top of the markdown  add some gothub style tech tags 