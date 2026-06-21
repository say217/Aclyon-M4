import os
import sys
import traceback
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from starlette.middleware.sessions import SessionMiddleware

from .app1.routes import router as app1_router
from .app2.routes import router as app2_router
from .app3.routes import router as app3_router
from .app4.routes import router as app4_router

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = FastAPI()
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SECRET_KEY", "change-me"))


# ── Eager pipeline load at startup ────────────────────────────────────────────
def _load_pipeline():
    try:
        project_root = Path(__file__).resolve().parent.parent.parent
        pipeline_dir = str(project_root / "Pipeline_src")

        if pipeline_dir not in sys.path:
            sys.path.insert(0, pipeline_dir)

        print(f"[INFO] Loading pipeline from: {pipeline_dir}")

        import execute as _execute_module
        pipeline_graph = _execute_module.app
        print("[INFO] Pipeline agent loaded successfully at startup")
        return pipeline_graph, None
    except Exception as e:
        print(f"[WARN] Pipeline agent could not be loaded: {e}")
        traceback.print_exc()
        return None, str(e)


app.state.pipeline, app.state.pipeline_error = _load_pipeline()


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(app1_router, prefix="/app1")
app.include_router(app2_router, prefix="/app2")
app.include_router(app3_router, prefix="/app3")
app.include_router(app4_router, prefix="/app4")


@app.get("/")
def root():
    return RedirectResponse(url="/app1/")  # TODO: revert to /app2/login when auth is ready