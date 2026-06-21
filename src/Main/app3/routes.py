import os
import sys
import sqlite3
import json
import traceback
from pathlib import Path
from fastapi import APIRouter, Body, Form, Request, status, UploadFile, File
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates

router = APIRouter()

templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent / "templates"))

DB_PATH = os.getenv("SQLITE_DB_PATH", str(Path(__file__).resolve().parents[3] / "database.db"))
PDF_DIR = Path(__file__).resolve().parents[3] / "data" / "pdfs"
UPLOAD_DIR = Path(__file__).resolve().parents[3] / "data" / "uploads"
METADATA_PATH = Path(__file__).resolve().parents[3] / "data" / "metadata" / "VLM_papers.json"

# Ensure upload directory exists
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_app3_tables():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS uploaded_papers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                paper_id TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                authors TEXT,
                year INTEGER,
                venue TEXT,
                abstract TEXT,
                local_pdf TEXT NOT NULL
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


ensure_app3_tables()


@router.get("/")
def home(request: Request):
    if not request.session.get("is_verified"):
        return RedirectResponse(url="/app2/login", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse("home3.html", {"request": request})


@router.get("/css/styles.css")
@router.get("/css/style.css")
def get_css():
    return FileResponse(str(Path(__file__).resolve().parent / "css" / "style.css"))


@router.get("/app.js")
def get_js():
    return FileResponse(str(Path(__file__).resolve().parent / "js" / "app.js"))


@router.get("/api/papers")
def get_papers():
    papers = []

    # 1. Load predefined papers
    if METADATA_PATH.exists():
        try:
            with open(METADATA_PATH, "r", encoding="utf-8") as f:
                predefined = json.load(f)
                for p in predefined:
                    papers.append({
                        "id": p.get("paper_id"),
                        "title": p.get("title", "Untitled"),
                        "authors": ", ".join(p.get("authors", [])) if isinstance(p.get("authors"), list) else p.get("authors", ""),
                        "year": p.get("year", 2026),
                        "venue": p.get("venue", "arXiv"),
                        "abstract": p.get("abstract", ""),
                        "collection": "nlp" if "nlp" in p.get("fields_of_study", []) or "NLP" in p.get("title", "") else "ml",
                        "favorite": False,
                        "uploaded": False,
                        "readingProgress": 0.0,
                        "pages": 15,
                        "readTime": 25
                    })
        except Exception as e:
            print(f"Error reading metadata: {e}")

    # 2. Load uploaded papers
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT paper_id, title, authors, year, venue, abstract, local_pdf FROM uploaded_papers")
        rows = cursor.fetchall()
        for row in rows:
            papers.append({
                "id": row["paper_id"],
                "title": row["title"],
                "authors": row["authors"] or "Local User",
                "year": row["year"] or 2026,
                "venue": row["venue"] or "Local PDF",
                "abstract": row["abstract"] or "Uploaded paper workspace.",
                "collection": "uploaded",
                "favorite": False,
                "uploaded": True,
                "readingProgress": 0.0,
                "pages": 10,
                "readTime": 15
            })
    finally:
        conn.close()

    return papers


@router.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        return JSONResponse(status_code=400, content={"error": "Only PDF files are allowed"})

    filename = file.filename
    paper_id = Path(filename).stem
    dest_path = UPLOAD_DIR / filename

    try:
        with open(dest_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Failed to save file: {e}"})

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        title = paper_id.replace("_", " ").replace("-", " ")
        cursor.execute(
            """
            INSERT OR REPLACE INTO uploaded_papers (paper_id, title, authors, year, venue, abstract, local_pdf)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                paper_id,
                title,
                "Local User",
                2026,
                "Local Upload",
                "Uploaded paper workspace.",
                str(dest_path.relative_to(Path(__file__).resolve().parents[3])),
            )
        )
        conn.commit()
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Database error: {e}"})
    finally:
        conn.close()

    return {
        "id": paper_id,
        "title": title,
        "authors": "Local User",
        "year": 2026,
        "venue": "Local Upload",
        "abstract": "Uploaded paper workspace.",
        "collection": "uploaded",
        "favorite": False,
        "uploaded": True,
        "readingProgress": 0.0,
        "pages": 10,
        "readTime": 15
    }


@router.get("/pdfs/{paper_id}.pdf")
def serve_pdf(paper_id: str):
    conn = get_db_connection()
    pdf_path = None
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT local_pdf FROM uploaded_papers WHERE paper_id = ?", (paper_id,))
        row = cursor.fetchone()
        if row:
            pdf_path = Path(__file__).resolve().parents[3] / row["local_pdf"]
    finally:
        conn.close()

    if not pdf_path or not pdf_path.exists():
        pdf_path = PDF_DIR / f"{paper_id}.pdf"

    if pdf_path.exists():
        return FileResponse(str(pdf_path), media_type="application/pdf")
    else:
        return JSONResponse(status_code=404, content={"error": "PDF file not found"})


@router.post("/api/chat")
async def chat(request: Request, payload: dict = Body(...)):
    if not request.session.get("is_verified"):
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})

    question       = payload.get("question", "").strip()
    paper_title    = payload.get("paper_title", "")
    paper_authors  = payload.get("paper_authors", "")
    paper_year     = payload.get("paper_year", "")
    paper_abstract = payload.get("paper_abstract", "")

    if not question:
        return JSONResponse(status_code=400, content={"error": "No question provided"})

    context_prefix = ""
    if paper_title:
        context_prefix = (
            f"[The user is currently viewing this paper: "
            f"\"{paper_title}\" by {paper_authors} ({paper_year}). "
            f"Abstract: {paper_abstract[:300]}]\n\n"
        )

    full_question = context_prefix + question

    # Read pipeline from app.state (loaded at startup in main.py)
    pipeline = request.app.state.pipeline
    pipeline_error = request.app.state.pipeline_error

    if pipeline is None:
        return JSONResponse(
            status_code=503,
            content={"error": f"Pipeline agent not available: {pipeline_error or 'unknown error'}"}
        )

    try:
        result = pipeline.invoke({
            "question":         full_question,
            "route":            "search",
            "documents":        [],
            "ranked_documents": [],
            "answer":           "",
        })
        answer = result.get("answer", "No response generated.")
        return {"answer": answer}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"Agent error: {str(e)}"})