# Implementation Plan - Load VLM Papers & PDF Upload Support in App 3

We will implement dynamic PDF loading and full PDF uploading capability in App 3. The center panel mock text viewer will be upgraded to load actual PDF files in an `iframe` viewer, and user-uploaded PDFs will be saved to the local `data/uploads` folder and persistent SQLite database.

## User Review Required

> [!IMPORTANT]
> - A new SQLite database table `uploaded_papers` will be initialized in `database.db` to save the metadata of uploaded PDFs.
> - Uploaded files will be stored in `data/uploads`.
> - All papers (both predefined VLM papers and uploaded files) will be viewable in a high-performance browser-native PDF iframe viewer.

## Proposed Changes

We will modify `app3/routes.py`, `home3.html`, and `app.js` to support these features.

---

### Backend Updates

#### [MODIFY] [routes.py](file:///c:/PROJECTS/Montage%20V7/src/Main/app3/routes.py)
- Redefine SQLite database connection support.
- Initialize `uploaded_papers` table on startup.
- Add `GET /app3/api/papers` endpoint that:
  - Reads predefined papers from `data/metadata/VLM_papers.json`.
  - Reads uploaded papers from SQLite.
  - Combines and returns them.
- Add `POST /app3/api/upload` endpoint that:
  - Stores uploaded files in `data/uploads/`.
  - Inserts their metadata into SQLite.
- Add `GET /app3/pdfs/{paper_id}.pdf` endpoint that serves the selected PDF file securely.

---

### Frontend HTML & CSS Updates

#### [MODIFY] [home3.html](file:///c:/PROJECTS/Montage%20V7/src/Main/app3/templates/home3.html)
- Add a hidden `<input type="file" id="pdfFileInput" accept=".pdf" />` for uploading files.
- Replace the mock text card structure inside `#pdfContainer` with an `<iframe>` container (`#pdfIframe`) to render the real PDF files.

---

### Frontend JS Updates

#### [MODIFY] [app.js](file:///c:/PROJECTS/Montage%20V7/src/Main/app3/js/app.js)
- Fetch `/app3/api/papers` on load and populate the sidebar with VLM papers dynamically.
- Implement click listener on `#uploadPdfBtn` to trigger file selection.
- Implement change listener on `#pdfFileInput` to send the selected file to `/app3/api/upload` via `FormData`, add it to the sidebar list, and open it immediately.
- When selecting a paper, point `#pdfIframe` to `/app3/pdfs/${paper.id}.pdf` and update the toolbar metadata.
