"""
citation_checker.py — Lightweight Citation Verifier (Gemini-only)
==================================================================
One model (Gemini), one DB (Semantic Scholar, free/no key).

Usage:
    from citation_checker import check
    report = check(text="...full paper text...")
"""

import json, re, time, os
import requests
from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types

load_dotenv()
_client     = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
TIMEOUT      = 10


# ── Step 1: Extract citations via Gemini ────────────────────────────────────

def _extract(text: str) -> list[dict]:
    prompt = (
        "Extract every citation from the academic text below.\n"
        "Return ONLY valid JSON, no markdown, exactly this shape:\n"
        '{"citations":[{"title":"","authors":"","year":""}]}\n\n'
        + text[:8000]
    )
    try:
        resp = _client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
            ),
        )
        return json.loads(resp.text).get("citations", [])[:10]
    except Exception as e:
        print(f"[WARN] citation_checker extract failed: {e}")
        return []


# ── Step 2: Verify via Semantic Scholar ─────────────────────────────────────

def _verify(citation: dict) -> dict:
    query = citation.get("title") or citation.get("authors") or ""
    if not query:
        return {"status": "unverifiable", "note": "No title or authors to search"}

    try:
        r = requests.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            params={"query": query, "limit": 3,
                    "fields": "title,authors,year,externalIds"},
            timeout=TIMEOUT,
        )
        results = r.json().get("data") or []
    except Exception as e:
        return {"status": "error", "note": str(e)}

    if not results:
        return {"status": "not_found", "note": "No match in Semantic Scholar"}

    best         = results[0]
    found_title  = best.get("title") or ""
    found_year   = str(best.get("year") or "")
    found_authors= ", ".join(a["name"] for a in (best.get("authors") or []))
    doi          = (best.get("externalIds") or {}).get("DOI", "")

    def norm(s): return re.sub(r"\W+", " ", (s or "").lower()).strip()
    claimed = norm(citation.get("title", ""))
    found   = norm(found_title)

    ratio   = (sum(w in found.split() for w in claimed.split())
               / max(len(claimed.split()), 1)) if claimed and found else 0
    year_ok = (citation.get("year", "") == found_year) if citation.get("year") else True

    if ratio > 0.6 and year_ok:
        status, note = "verified", ""
    elif ratio > 0.4:
        status = "mismatch"
        note   = f"Partial match; claimed year={citation.get('year')}, found={found_year}"
    else:
        status = "not_found"
        note   = f"Closest: '{found_title}' ({found_year}) — low similarity"

    return {"status": status, "found_title": found_title,
            "found_authors": found_authors, "found_year": found_year,
            "found_doi": doi, "note": note}


# ── Main ─────────────────────────────────────────────────────────────────────

def check(text: str) -> dict:
    citations = _extract(text)
    results, counts = [], {"verified": 0, "mismatch": 0, "not_found": 0, "unverifiable": 0}

    for c in citations:
        v = _verify(c)
        s = v["status"] if v["status"] in counts else "unverifiable"
        counts[s] += 1
        results.append({"claimed_title": c.get("title", ""),
                         "claimed_authors": c.get("authors", ""),
                         "claimed_year": c.get("year", ""), **v})
        time.sleep(0.2)

    return {"total": len(results), **counts, "citations": results}


if __name__ == "__main__":
    import sys
    text = sys.stdin.read() if not sys.stdin.isatty() else " ".join(sys.argv[1:])
    print(json.dumps(check(text), indent=2))