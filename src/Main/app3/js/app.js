/**
 * ACLYON — Research Intelligence Platform
 * app.js
 *
 * Architecture:
 *  - ResearchLibrary: data store + filtering
 *  - SidebarController: renders paper cards, handles selection
 *  - ViewerController: controls PDF workspace
 *  - CopilotController: chat UI, AI responses
 *  - App: orchestrates all controllers
 */

'use strict';

/* ══════════════════════════════════════════════════════════
   RESEARCH DATA STORE (Populated dynamically on initialization)
   ══════════════════════════════════════════════════════════ */
let PAPERS = [];

/* Quick access lookup helper */
function getPaperMap() {
  return Object.fromEntries(PAPERS.map(p => [p.id, p]));
}


/* ══════════════════════════════════════════════════════════
   CHIP PROMPTS — quick-action buttons map to real questions
   sent to the LangGraph research agent
   ══════════════════════════════════════════════════════════ */
const CHIP_PROMPTS = {
  summarize: (paper) => `Summarize this paper${paper ? ` ("${paper.title}")` : ''} for me \u2014 core contribution, methods, and key results.`,
  compare: () => `Compare the papers in my library \u2014 highlight methodological differences, performance benchmarks, and conceptual similarities.`,
  limitations: (paper) => `What are the limitations and weaknesses of this paper${paper ? ` ("${paper.title}")` : ''}?`,
  insights: (paper) => `Extract the key insights and takeaways from this paper${paper ? ` ("${paper.title}")` : ''}.`,
  citations: (paper) => `Give me a proper APA citation for this paper${paper ? ` ("${paper.title}")` : ''}.`,
  related: (paper) => `What related work or papers in the library are most relevant to this paper${paper ? ` ("${paper.title}")` : ''}?`,
  equations: (paper) => `Explain the key equations or formulas used in this paper${paper ? ` ("${paper.title}")` : ''}.`,
};

/* ══════════════════════════════════════════════════════════
   MARKDOWN \u2014 lightweight renderer for agent responses
   ══════════════════════════════════════════════════════════ */
function renderMarkdown(raw) {
  let text = raw == null ? '' : String(raw);

  // Escape HTML first
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks ```...```
  text = text.replace(/```([\s\S]*?)```/g, (_, code) =>
    `<div class="code-block">${code.trim()}</div>`
  );

  // Inline code `...`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold **text**
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italics *text* (avoid clashing with already-converted strong tags)
  text = text.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1<em>$2</em>$3');

  // Markdown links [text](url)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Bare URLs
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

  // Split into lines for list / paragraph handling
  const lines = text.split('\n');
  let html = '';
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[-*\u2022]\s+(.*)$/);
    const numberedMatch = trimmed.match(/^\d+\.\s+(.*)$/);

    if (bulletMatch || numberedMatch) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${bulletMatch ? bulletMatch[1] : numberedMatch[1]}</li>`;
      continue;
    }

    if (inList) {
      html += '</ul>';
      inList = false;
    }

    if (trimmed === '') {
      html += '<br>';
    } else if (/^<div class="code-block">/.test(trimmed)) {
      html += trimmed;
    } else {
      html += `<p>${line}</p>`;
    }
  }

  if (inList) html += '</ul>';

  return html;
}


/* ══════════════════════════════════════════════════════════
   UTILITY
   ══════════════════════════════════════════════════════════ */
function qs(sel, ctx = document) { return ctx.querySelector(sel); }
function qsa(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function shortAuthors(authors) {
  if (!authors) return '—';
  const parts = authors.split(',');
  if (parts.length <= 2) return authors;
  return parts[0].trim() + ' et al.';
}

function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


/* ══════════════════════════════════════════════════════════
   SIDEBAR CONTROLLER
   ══════════════════════════════════════════════════════════ */
class SidebarController {
  constructor(onSelectPaper) {
    this.onSelectPaper = onSelectPaper;
    this.selectedId = null;
    this.searchQuery = '';
    this.currentCollection = 'all';

    this.recentList = qs('#recentPapersList');
    this.favoritesList = qs('#favoritesPapersList');
    this.uploadedList = qs('#uploadedPapersList');
    this.searchInput = qs('#searchInput');
    this.collapseBtn = qs('#sidebarCollapseBtn');
    this.sidebar = qs('#sidebar');
    this.navItems = qsa('#collectionsList .nav-item');

    this._bindEvents();
    this.render();
  }

  _bindEvents() {
    this.searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.render();
    });

    this.collapseBtn.addEventListener('click', () => {
      this.sidebar.classList.toggle('collapsed');
    });

    this.navItems.forEach(item => {
      item.addEventListener('click', () => {
        this.navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        this.currentCollection = item.dataset.collection || 'all';
        this.render();
      });
    });

    qs('#uploadPdfBtn').addEventListener('click', () => {
      const fileInput = document.getElementById('pdfFileInput');
      if (fileInput) fileInput.click();
    });

    qs('#createCollectionBtn').addEventListener('click', () => showToast('Collection created'));
    qs('#settingsBtn').addEventListener('click', () => showToast('Settings panel coming soon'));
  }

  _filter(papers) {
    let filtered = papers;
    if (this.currentCollection && this.currentCollection !== 'all') {
      filtered = filtered.filter(p => p.collection === this.currentCollection);
    }
    if (this.searchQuery) {
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(this.searchQuery) ||
        (p.authors && p.authors.toLowerCase().includes(this.searchQuery)) ||
        (p.tags && p.tags.some(t => t.toLowerCase().includes(this.searchQuery)))
      );
    }
    return filtered;
  }

  _makeCard(paper) {
    const li = document.createElement('li');
    li.className = 'paper-card' + (paper.id === this.selectedId ? ' active' : '');
    li.dataset.id = paper.id;
    li.innerHTML = `
      <div class="paper-card-title">${paper.title}</div>
      <div class="paper-card-meta">
        <span class="paper-card-year">${paper.year}</span>
        <span class="paper-card-authors">${shortAuthors(paper.authors)}</span>
      </div>
    `;
    li.addEventListener('click', () => this._select(paper.id));
    return li;
  }

  _renderList(container, papers, emptyText) {
    container.innerHTML = '';
    const filtered = this._filter(papers);
    if (filtered.length === 0) {
      const li = document.createElement('li');
      li.className = 'paper-list-empty';
      li.textContent = this.searchQuery ? 'No matches' : emptyText;
      container.appendChild(li);
      return;
    }
    filtered.forEach(p => container.appendChild(this._makeCard(p)));
  }

  render() {
    const allPapers = PAPERS;
    const favs = PAPERS.filter(p => p.favorite);
    const uploaded = PAPERS.filter(p => p.uploaded);

    this._renderList(this.recentList, allPapers, 'No papers in library');
    this._renderList(this.favoritesList, favs, 'No favorites yet');
    this._renderList(this.uploadedList, uploaded, 'No uploads yet');

    // Update nav item badges dynamically
    this.navItems.forEach(item => {
      const coll = item.dataset.collection;
      const badge = item.querySelector('.nav-badge');
      if (badge) {
        if (coll === 'all') badge.textContent = PAPERS.length;
        else badge.textContent = PAPERS.filter(p => p.collection === coll).length;
      }
    });

    // Update the uploaded section badge at the header
    const uploadedNavHeader = qsa('#sidebar .nav-section-header').find(el => {
      const label = el.querySelector('.nav-section-label');
      return label && label.textContent.includes('Uploaded');
    });
    if (uploadedNavHeader) {
      const badge = uploadedNavHeader.querySelector('.nav-badge');
      if (badge) badge.textContent = uploaded.length;
    }
  }

  _select(id) {
    this.selectedId = id;
    // Update active state class on all cards
    qsa('.paper-card').forEach(card => {
      card.classList.toggle('active', card.dataset.id === id);
    });
    const paper = getPaperMap()[id];
    if (paper) {
      this.onSelectPaper(paper);
    }
  }

  setSelected(id) {
    this.selectedId = id;
    this.render();
  }
}


/* ══════════════════════════════════════════════════════════
   VIEWER CONTROLLER
   ══════════════════════════════════════════════════════════ */
class ViewerController {
  constructor() {
    this.currentPaper = null;
    this.zoom = 100;
    this.zoomStep = 10;
    this.minZoom = 60;
    this.maxZoom = 200;

    this.empty = qs('#viewerEmpty');
    this.container = qs('#pdfContainer');
    this.toolbarTitle = qs('#toolbarTitle');
    this.toolbarAuthors = qs('#toolbarAuthors');
    this.zoomLevelEl = qs('#zoomLevel');
    this.infoPage = qs('#infoPage');
    this.infoYear = qs('#infoYear');
    this.infoReadTime = qs('#infoReadTime');
    this.progressFill = qs('#progressFill');
    this.pdfPaper = qs('.pdf-paper');

    this._bindEvents();
  }

  _bindEvents() {
    qs('#zoomInBtn').addEventListener('click', () => this._setZoom(this.zoom + this.zoomStep));
    qs('#zoomOutBtn').addEventListener('click', () => this._setZoom(this.zoom - this.zoomStep));
    qs('#downloadBtn').addEventListener('click', () => {
      if (this.currentPaper) {
        window.open(`/app3/pdfs/${this.currentPaper.id}.pdf`, '_blank');
      }
    });
    qs('#bookmarkBtn').addEventListener('click', () => {
      qs('#bookmarkBtn').classList.toggle('active');
      showToast(qs('#bookmarkBtn').classList.contains('active') ? 'Bookmarked' : 'Bookmark removed');
    });
    qs('#searchPaperBtn').addEventListener('click', () => showToast('Search inside PDF tool active'));
  }

  _setZoom(level) {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, level));
    this.zoomLevelEl.textContent = `${this.zoom}%`;
    if (this.pdfPaper) {
      this.pdfPaper.style.transform = `scale(${this.zoom / 100})`;
    }
  }

  loadPaper(paper) {
    this.currentPaper = paper;
    this.zoom = 100;
    this.zoomLevelEl.textContent = '100%';

    // Update toolbar
    this.toolbarTitle.textContent = paper.title;
    this.toolbarAuthors.textContent = `${shortAuthors(paper.authors)} · ${paper.venue}`;

    // Info bar
    const currentPage = Math.round(paper.pages * paper.readingProgress) || 1;
    this.infoPage.textContent = `Page ${currentPage} of ${paper.pages}`;
    this.infoYear.textContent = paper.year;
    this.infoReadTime.textContent = `~${paper.readTime} min read`;
    this.progressFill.style.width = `${Math.round(paper.readingProgress * 100)}%`;

    // Set Iframe src to render actual PDF
    const iframe = document.getElementById('pdfIframe');
    if (iframe) {
      iframe.src = `/app3/pdfs/${paper.id}.pdf`;
    }

    // Show container
    this.empty.style.display = 'none';
    this.container.style.display = 'block';
  }

  showEmpty() {
    this.currentPaper = null;
    this.empty.style.display = 'flex';
    this.container.style.display = 'none';
    this.toolbarTitle.textContent = 'No paper selected';
    this.toolbarAuthors.textContent = '—';
    this.infoPage.textContent = '—';
    this.infoYear.textContent = '—';
    this.infoReadTime.textContent = '—';
    this.progressFill.style.width = '0%';
  }
}


/* ══════════════════════════════════════════════════════════
   COPILOT CONTROLLER
   ══════════════════════════════════════════════════════════ */
class CopilotController {
  constructor() {
    this.currentPaper = null;
    this.isThinking = false;

    this.chatArea = qs('#chatArea');
    this.textarea = qs('#chatTextarea');
    this.sendBtn = qs('#sendBtn');
    this.chipsBar = qs('#chipsBar');

    this._bindEvents();
  }

  _bindEvents() {
    // Auto-resize textarea
    this.textarea.addEventListener('input', () => {
      this.textarea.style.height = 'auto';
      this.textarea.style.height = Math.min(this.textarea.scrollHeight, 140) + 'px';
    });

    // Send on Enter (Shift+Enter for newline)
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendMessage();
      }
    });

    this.sendBtn.addEventListener('click', () => this._sendMessage());

    // Chips
    this.chipsBar.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const action = chip.dataset.action;
      this._handleChipAction(action);
    });

    qs('#attachBtn').addEventListener('click', () => showToast('Attachment options ready'));
  }

  setPaper(paper) {
    this.currentPaper = paper;
    if (paper) {
      this._addSystemNote(`Aclyon is now reviewing: "${truncate(paper.title, 60)}"`);
    }
  }

  _handleChipAction(action) {
    if (this.isThinking) return;

    const labels = {
      summarize: 'Summarize this paper',
      compare: 'Compare papers in my library',
      limitations: 'Find limitations of this work',
      insights: 'Extract key insights',
      citations: 'Generate APA citation',
      related: 'Find related work',
      equations: 'Explain key equations'
    };

    const promptFn = CHIP_PROMPTS[action];
    const question = promptFn ? promptFn(this.currentPaper) : (labels[action] || action);
    const displayText = labels[action] || action;

    this._addUserMessage(displayText);
    this._sendToAgent(question);
  }

  async _sendMessage() {
    const text = this.textarea.value.trim();
    if (!text || this.isThinking) return;

    this.textarea.value = '';
    this.textarea.style.height = 'auto';
    this._addUserMessage(text);
    this._sendToAgent(text);
  }

  _addUserMessage(text) {
    const msg = document.createElement('div');
    msg.className = 'message user-message';
    msg.innerHTML = `
      <div class="msg-avatar">You</div>
      <div class="msg-bubble">
        <p>${this._escapeHtml(text)}</p>
      </div>
    `;
    this.chatArea.appendChild(msg);
    this._scrollToBottom();
  }

  _addSystemNote(text) {
    const note = document.createElement('div');
    note.style.cssText = `
      font-size: 11px;
      color: var(--text-faint);
      text-align: center;
      padding: 4px 0;
    `;
    note.textContent = text;
    this.chatArea.appendChild(note);
    this._scrollToBottom();
  }

  async _sendToAgent(question) {
    this.isThinking = true;
    this.sendBtn.disabled = true;

    // Show thinking indicator
    const thinkingEl = this._addThinkingIndicator();

    const paper = this.currentPaper;
    const payload = {
      question,
      paper_id: paper ? paper.id : '',
      paper_title: paper ? paper.title : '',
      paper_authors: paper ? paper.authors : '',
      paper_year: paper ? paper.year : '',
      paper_abstract: paper ? paper.abstract : '',
    };

    try {
      const res = await fetch('/app3/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      thinkingEl.remove();

      if (!res.ok) {
        this._addAssistantMessage(data.error || 'The research agent ran into an error.', true);
      } else {
        this._addAssistantMessage(data.answer || 'No response generated.');
      }
    } catch (err) {
      console.error(err);
      thinkingEl.remove();
      this._addAssistantMessage(`Connection error: ${err.message}`, true);
    } finally {
      this.isThinking = false;
      this.sendBtn.disabled = false;
    }
  }

  _addThinkingIndicator() {
    const wrapper = document.createElement('div');
    wrapper.className = 'message assistant-message';
    wrapper.innerHTML = `
      <div class="msg-avatar">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1.5C3.96 1.5 1.5 3.96 1.5 7S3.96 12.5 7 12.5 12.5 10.04 12.5 7 10.04 1.5 7 1.5z" fill="#3B82F6" opacity="0.25"/>
          <path d="M4.5 7.5L6.5 9.5L9.5 5.5" stroke="#3B82F6" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="msg-bubble">
        <div class="thinking-indicator">
          <div class="thinking-dot"></div>
          <div class="thinking-dot"></div>
          <div class="thinking-dot"></div>
        </div>
      </div>
    `;
    this.chatArea.appendChild(wrapper);
    this._scrollToBottom();
    return wrapper;
  }

  _addAssistantMessage(content, isError = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message assistant-message';

    const contentHtml = isError
      ? `<div class="agent-error">${this._escapeHtml(content)}</div>`
      : `<div class="agent-answer">${renderMarkdown(content)}</div>`;

    wrapper.innerHTML = `
      <div class="msg-avatar">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1.5C3.96 1.5 1.5 3.96 1.5 7S3.96 12.5 7 12.5 12.5 10.04 12.5 7 10.04 1.5 7 1.5z" fill="#3B82F6" opacity="0.25"/>
          <path d="M4.5 7.5L6.5 9.5L9.5 5.5" stroke="#3B82F6" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="msg-bubble">
        ${contentHtml}
        <div class="msg-time">${formatTime()}</div>
      </div>
    `;

    this.chatArea.appendChild(wrapper);
    this._scrollToBottom();
  }

  _escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _scrollToBottom() {
    requestAnimationFrame(() => {
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
    });
  }
}


/* ══════════════════════════════════════════════════════════
   APP — Root orchestrator
   ══════════════════════════════════════════════════════════ */
class AclyonApp {
  constructor() {
    this.viewer = new ViewerController();
    this.copilot = new CopilotController();
    this.sidebar = null;

    this.init();
  }

  async init() {
    try {
      const response = await fetch('/app3/api/papers');
      const data = await response.json();
      PAPERS.length = 0;
      PAPERS.push(...data);
    } catch (e) {
      console.error("Failed to load papers", e);
      showToast("Error loading paper library metadata");
    }

    this.sidebar = new SidebarController((paper) => this._onPaperSelected(paper));

    // Bind file upload input change handler
    const fileInput = document.getElementById('pdfFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        showToast('Uploading PDF...');
        try {
          const res = await fetch('/app3/api/upload', {
            method: 'POST',
            body: formData
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Upload failed');
          }
          const newPaper = await res.json();
          PAPERS.unshift(newPaper);
          this.sidebar.render();
          this.sidebar._select(newPaper.id);
          showToast('Upload successful!');
        } catch (err) {
          console.error(err);
          showToast(`Upload failed: ${err.message}`);
        } finally {
          fileInput.value = '';
        }
      });
    }

    // Load first paper by default if available
    if (PAPERS.length > 0) {
      this.sidebar.setSelected(PAPERS[0].id);
      this._onPaperSelected(PAPERS[0]);
    }
  }

  _onPaperSelected(paper) {
    this.viewer.loadPaper(paper);
    this.copilot.setPaper(paper);
  }
}


/* ══════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  new AclyonApp();
});