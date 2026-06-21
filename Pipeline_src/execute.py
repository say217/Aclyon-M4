"""
execute.py — Research Agent Pipeline
======================================
LangGraph pipeline:
  route → [catalog | retrieve → rerank → generate] → END

Routing logic:
  • "how many papers" / "list all" / "paper N" → catalog_node  (no vector search needed)
  • anything else                               → retrieve_node → rank_node → generate_node

NOTE: The compiled LangGraph graph is exported as 'app' from this module.
      In main.py it is imported as:
          import execute as _execute_module
          pipeline_graph = _execute_module.app
      This avoids the name collision with the FastAPI 'app' object.
"""

import os
import re
import sys
from typing import TypedDict, Literal
from langgraph.graph import StateGraph, END

# Ensure Pipeline_src/ is on sys.path so 'connections' resolves correctly
# when this module is imported from outside its own directory (e.g. from main.py).
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from connections import (
    retrieve,
    rerank_documents,
    generate_answer,
    get_catalog_summary,
    get_paper_count,
    PAPER_CATALOG,
)


# ── State ──────────────────────────────────────────────────────────────────

class GraphState(TypedDict):
    question:         str
    route:            Literal["catalog", "search"]
    documents:        list
    ranked_documents: list
    answer:           str


# ── Routing ────────────────────────────────────────────────────────────────

_CATALOG_PATTERNS = re.compile(
    r"""
    how\s+many\s+paper|
    total\s+paper|
    list\s+(all|the)\s+paper|
    all\s+paper|
    paper\s+titles|
    show\s+(me\s+)?all|
    what\s+papers|
    which\s+papers|
    paper\s+(number\s+)?\d+|
    \bpaper\s+\d+\b|
    \btitle\s+of\s+(all|every)
    """,
    re.IGNORECASE | re.VERBOSE,
)


def route_node(state: GraphState) -> GraphState:
    q = state["question"].lower()
    if _CATALOG_PATTERNS.search(q):
        return {**state, "route": "catalog"}
    return {**state, "route": "search"}


def should_use_catalog(state: GraphState) -> str:
    return state["route"]   # "catalog" or "search"


# ── Nodes ──────────────────────────────────────────────────────────────────

def catalog_node(state: GraphState) -> GraphState:
    """
    Directly answer questions about the catalog (count, titles, paper N)
    without doing a vector search — uses the full in-memory catalog.
    """
    q = state["question"]
    total = get_paper_count()

    # Check for "paper N" or "paper number N"
    m = re.search(r"paper\s+(?:number\s+)?(\d+)", q, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        if 1 <= n <= total:
            p = PAPER_CATALOG[n - 1]
            answer = (
                f"Paper {n} of {total}:\n\n"
                f"**Title:** {p['title']}\n"
                f"**Authors:** {p['authors']}\n"
                f"**Year:** {p['year']}\n"
                f"**URL:** {p['url']}\n\n"
                f"**Abstract preview:** {p['abstract']}"
            )
        else:
            answer = f"There are only {total} papers in the library. Please ask for paper 1–{total}."
        return {**state, "documents": [], "ranked_documents": [], "answer": answer}

    # General catalog / "how many" / "list all"
    catalog_text = get_catalog_summary()
    answer = (
        f"The library contains **{total} papers**. Here is the full list:\n\n"
        f"{catalog_text}"
    )
    return {**state, "documents": [], "ranked_documents": [], "answer": answer}


def retrieve_node(state: GraphState) -> GraphState:
    docs = retrieve(state["question"], top_k=30)
    return {**state, "documents": docs}


def rank_node(state: GraphState) -> GraphState:
    ranked = rerank_documents(
        state["question"],
        state["documents"],
        top_k=6,
    )
    return {**state, "ranked_documents": ranked}


def generate_node(state: GraphState) -> GraphState:
    answer = generate_answer(
        state["question"],
        state["ranked_documents"],
    )
    return {**state, "answer": answer}


# ── Build graph ────────────────────────────────────────────────────────────

workflow = StateGraph(GraphState)

workflow.add_node("router",   route_node)
workflow.add_node("catalog",  catalog_node)
workflow.add_node("retrieve", retrieve_node)
workflow.add_node("rank",     rank_node)
workflow.add_node("generate", generate_node)

workflow.set_entry_point("router")

workflow.add_conditional_edges(
    "router",
    should_use_catalog,
    {
        "catalog": "catalog",
        "search":  "retrieve",
    }
)

workflow.add_edge("catalog",  END)
workflow.add_edge("retrieve", "rank")
workflow.add_edge("rank",     "generate")
workflow.add_edge("generate", END)

# This is the object imported by main.py as _execute_module.app
app = workflow.compile()


# ── CLI (unchanged) ────────────────────────────────────────────────────────

def _print_separator():
    print("\n" + "─" * 60)


def main():
    total = get_paper_count()
    print(f"\n{'='*60}")
    print(f"  Research Agent  |  {total} papers loaded")
    print(f"  Hybrid search: Dense (BGE) + Sparse (BM25) + Reranking")
    print(f"  Model: Qwen2.5-7B-Instruct via HuggingFace")
    print(f"{'='*60}")
    print("  Type your question below.  Commands: 'list', 'exit'\n")

    while True:
        try:
            question = input("Question: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not question:
            continue

        if question.lower() in ("exit", "quit", "q"):
            print("Goodbye!")
            break

        if question.lower() in ("list", "ls", "list all", "show all"):
            question = "list all papers"

        result = app.invoke(
            {
                "question":         question,
                "route":            "search",
                "documents":        [],
                "ranked_documents": [],
                "answer":           "",
            }
        )

        _print_separator()
        print("\nAnswer:\n")
        print(result["answer"])
        _print_separator()


if __name__ == "__main__":
    main()