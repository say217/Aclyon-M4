import arxiv
import json
import requests
from pathlib import Path
from tqdm import tqdm


def collect_arxiv_papers(topic, max_results=20):

    Path("data/pdfs").mkdir(parents=True, exist_ok=True)
    Path("data/metadata").mkdir(parents=True, exist_ok=True)

    search = arxiv.Search(
        query=topic,
        max_results=max_results,
        sort_by=arxiv.SortCriterion.Relevance
    )

    client = arxiv.Client()

    papers_metadata = []

    print(f"\nCollecting papers for: {topic}\n")

    for paper in tqdm(client.results(search), total=max_results):

        arxiv_id = paper.entry_id.split("/")[-1]

        metadata = {
            "arxiv_id": arxiv_id,
            "title": paper.title,
            "authors": [author.name for author in paper.authors],
            "summary": paper.summary,
            "published": str(paper.published),
            "updated": str(paper.updated),
            "categories": paper.categories,
            "pdf_url": paper.pdf_url,
            "entry_url": paper.entry_id
        }

        try:
            pdf_path = f"data/pdfs/{arxiv_id}.pdf"

            response = requests.get(
                paper.pdf_url,
                timeout=60
            )

            if response.status_code == 200:

                with open(pdf_path, "wb") as f:
                    f.write(response.content)

                metadata["local_pdf"] = pdf_path

            else:
                print(
                    f"Failed PDF download: {arxiv_id} "
                    f"(status={response.status_code})"
                )

        except Exception as e:
            print(f"Failed PDF download: {arxiv_id}")
            print(e)

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

    collect_arxiv_papers(
        topic=topic,
        max_results=20
    )