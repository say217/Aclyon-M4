import requests
import json
from pathlib import Path
from tqdm import tqdm


def collect_semantic_scholar_papers(topic, max_results=20):

    Path("data/metadata").mkdir(parents=True, exist_ok=True)

    url = "https://api.semanticscholar.org/graph/v1/paper/search"

    params = {
        "query": topic,
        "limit": max_results,
        "fields": ",".join([
            "paperId",
            "title",
            "abstract",
            "year",
            "citationCount",
            "referenceCount",
            "authors",
            "fieldsOfStudy",
            "openAccessPdf",
            "url",
            "venue"
        ])
    }

    print(f"\nCollecting papers for: {topic}\n")

    response = requests.get(
        url,
        params=params,
        timeout=60
    )

    response.raise_for_status()

    results = response.json()

    papers_metadata = []

    for paper in tqdm(results.get("data", [])):

        metadata = {
            "paper_id": paper.get("paperId"),
            "title": paper.get("title"),
            "abstract": paper.get("abstract"),
            "year": paper.get("year"),
            "citation_count": paper.get("citationCount"),
            "reference_count": paper.get("referenceCount"),
            "venue": paper.get("venue"),
            "fields_of_study": paper.get("fieldsOfStudy"),
            "authors": [
                author.get("name")
                for author in paper.get("authors", [])
            ],
            "paper_url": paper.get("url"),
            "pdf_url": (
                paper.get("openAccessPdf", {})
                .get("url")
                if paper.get("openAccessPdf")
                else None
            ),
            "source": "semantic_scholar"
        }

        papers_metadata.append(metadata)

    metadata_path = (
        f"data/metadata/"
        f"{topic.replace(' ', '_')}_papers.json"
    )

    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(
            papers_metadata,
            f,
            indent=4,
            ensure_ascii=False
        )

    print(f"\nSaved metadata to {metadata_path}")
    print(f"Collected {len(papers_metadata)} papers")

    return papers_metadata


if __name__ == "__main__":

    topic = input("Enter research topic: ")

    collect_semantic_scholar_papers(
        topic=topic,
        max_results=20
    )