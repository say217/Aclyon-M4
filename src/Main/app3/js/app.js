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

  // 1. Extract Display Math (Blocks)
  const displayMathBlocks = [];
  // Match $$ ... $$ (can span multiple lines)
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
    const placeholder = `__MATH_DISPLAY_${displayMathBlocks.length}__`;
    displayMathBlocks.push(math);
    return `\n\n${placeholder}\n\n`;
  });
  // Match \[ ... \] (can span multiple lines)
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (match, math) => {
    const placeholder = `__MATH_DISPLAY_${displayMathBlocks.length}__`;
    displayMathBlocks.push(math);
    return `\n\n${placeholder}\n\n`;
  });

  // 2. Extract Inline Math
  const inlineMathBlocks = [];
  // Match $ ... $ (non-newline, non-escaped $)
  text = text.replace(/(?<!\\)\$((?!\s)[^$\n]+?(?<!\s))(?<!\\)\$/g, (match, math) => {
    const placeholder = `__MATH_INLINE_${inlineMathBlocks.length}__`;
    inlineMathBlocks.push(math);
    return placeholder;
  });
  // Match \( ... \)
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (match, math) => {
    const placeholder = `__MATH_INLINE_${inlineMathBlocks.length}__`;
    inlineMathBlocks.push(math);
    return placeholder;
  });

  // 3. Escape HTML first
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
    } else if (/^__MATH_DISPLAY_\d+__$/.test(trimmed)) {
      // Display math block shouldn't be wrapped in a <p> tag
      html += trimmed;
    } else {
      html += `<p>${line}</p>`;
    }
  }

  if (inList) html += '</ul>';

  // 4. Restore Display Math
  displayMathBlocks.forEach((math, idx) => {
    html = html.replace(`__MATH_DISPLAY_${idx}__`, `$$$$${math}$$$$`);
  });

  // 5. Restore Inline Math
  inlineMathBlocks.forEach((math, idx) => {
    html = html.replace(`__MATH_INLINE_${idx}__`, `$$${math}$$`);
  });

  return html;
}


function renderMath(element) {
  if (window.renderMathInElement) {
    try {
      window.renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\begin{equation}', right: '\\end{equation}', display: true },
          { left: '\\begin{align}', right: '\\end{align}', display: true },
          { left: '\\begin{gather}', right: '\\end{gather}', display: true }
        ],
        throwOnError: false
      });
    } catch (e) {
      console.error("KaTeX math rendering failed:", e);
    }
  }
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

    // Citation Checker
    const checkerBtn = qs('#citationCheckerBtn');
    const modal = qs('#citationModal');
    const closeBtn = qs('#closeCitationModalBtn');
    const modalBody = qs('#citationModalBody');

    if (checkerBtn && modal && closeBtn) {
      checkerBtn.addEventListener('click', async () => {
        if (!this.currentPaper) {
          showToast('Please select a paper first');
          return;
        }
        modal.style.display = 'flex';
        modalBody.innerHTML = `
          <div class="skeleton-loader" style="animation: pulse 1.5s infinite; opacity: 0.7;">
            <div style="height: 24px; background: #1e293b; border-radius: 4px; width: 40%; margin-bottom: 24px;"></div>
            <div style="height: 16px; background: #1e293b; border-radius: 4px; width: 80%; margin-bottom: 12px;"></div>
            <div style="height: 80px; background: #1e293b; border-radius: 6px; width: 100%; margin-bottom: 16px;"></div>
            <div style="height: 80px; background: #1e293b; border-radius: 6px; width: 100%; margin-bottom: 16px;"></div>
            <div style="height: 80px; background: #1e293b; border-radius: 6px; width: 100%; margin-bottom: 16px;"></div>
            <style>
              @keyframes pulse {
                0% { opacity: 0.5; }
                50% { opacity: 1; }
                100% { opacity: 0.5; }
              }
            </style>
          </div>
        `;

        try {
          const res = await fetch('/app3/api/citation-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paper_id: this.currentPaper.id,
              paper_title: this.currentPaper.title,
              paper_abstract: this.currentPaper.abstract,
              paper_authors: this.currentPaper.authors,
              paper_year: this.currentPaper.year
            })
          });

          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to check citations');
          }
          
          const report = await res.json();
          this._renderCitationReport(report, modalBody);
        } catch (err) {
          modalBody.innerHTML = `<div style="color: #ef4444;">Error: ${err.message}</div>`;
        }
      });

      closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }
  }

  _renderCitationReport(report, container) {
    if (report.error) {
      container.innerHTML = `<div style="color: #ef4444;">Error: ${report.error}</div>`;
      return;
    }
    
    let html = `<h4 style="margin-top:0;">Paper: ${report.paper?.title || 'Unknown'}</h4>`;
    html += `<p style="margin-bottom:16px;">Total Citations: ${report.summary.total} (Verified: <span style="color:#22c55e">${report.summary.verified}</span>, Mismatch: <span style="color:#f59e0b">${report.summary.mismatch}</span>, Not Found: <span style="color:#ef4444">${report.summary.not_found}</span>, Unverifiable: <span style="color:#94a3b8">${report.summary.unverifiable}</span>)</p>`;
    
    if (!report.citations || report.citations.length === 0) {
      html += `<p>No citations found.</p>`;
      container.innerHTML = html;
      return;
    }
    
    html += `<ul style="list-style: none; padding: 0; margin-top: 16px;">`;
    report.citations.forEach((cit) => {
      let statusColor = '#94a3b8'; // unverifiable
      if (cit.status === 'verified') statusColor = '#22c55e';
      else if (cit.status === 'mismatch') statusColor = '#f59e0b';
      else if (cit.status === 'not_found') statusColor = '#ef4444';
      
      html += `<li style="background: #020617; padding: 16px; margin-bottom: 12px; border-radius: 6px; border-left: 4px solid ${statusColor};">`;
      html += `<div style="font-weight: 600; margin-bottom: 4px;">Claimed: ${cit.claimed_title || 'No Title'}</div>`;
      
      let claimedMeta = [];
      if (cit.claimed_authors) claimedMeta.push(`Authors: ${cit.claimed_authors}`);
      if (cit.claimed_year) claimedMeta.push(`Year: ${cit.claimed_year}`);
      
      if (claimedMeta.length > 0) {
        html += `<div style="font-size: 12px; color: #94a3b8; margin-bottom: 8px;">${claimedMeta.join(' | ')}</div>`;
      }

      html += `<div style="font-size: 12px; margin-bottom: 8px;">Status: <span style="color: ${statusColor}; font-weight: bold;">${cit.status.toUpperCase()}</span></div>`;
      
      let foundMeta = [];
      if (cit.found_title) foundMeta.push(`Title: ${cit.found_title}`);
      if (cit.found_authors) foundMeta.push(`Authors: ${cit.found_authors}`);
      if (cit.found_year) foundMeta.push(`Year: ${cit.found_year}`);
      if (cit.found_doi) foundMeta.push(`DOI: ${cit.found_doi}`);

      if (foundMeta.length > 0) {
        html += `<div style="font-size: 12px; color: #cbd5e1; margin-bottom: 4px; padding: 12px; background: #1e293b; border-radius: 4px;"><strong>Found Match:</strong><br>${foundMeta.join(' | ')}</div>`;
      }

      if (cit.note) {
        html += `<div style="font-size: 12px; color: #f59e0b; margin-top: 8px;">Notes: ${cit.note}</div>`;
      }
      
      html += `</li>`;
    });
    html += `</ul>`;
    
    container.innerHTML = html;
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
      const res = await fetch('/app3/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        thinkingEl.remove();
        let errMsg = 'The research agent ran into an error.';
        try {
          const errorText = await res.text();
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            errMsg = JSON.parse(errorText).error || errMsg;
          } else if (errorText) {
            errMsg = errorText;
          }
        } catch (_) { /* Keep the default error message. */ }
        this._addAssistantMessage(errMsg, true);
        return;
      }

      if (!res.body) {
        // Fallback for environments without streaming body support.
        thinkingEl.remove();
        const text = await res.text();
        this._addAssistantMessage(text || 'No response generated.');
        return;
      }

      // Swap the thinking indicator for a live bubble we fill token-by-token.
      thinkingEl.remove();
      const { wrapper, bubbleContent } = this._addAssistantMessageStream();

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkText = decoder.decode(value, { stream: true });
        if (!chunkText) continue;

        fullText += chunkText;
        bubbleContent.innerHTML = renderMarkdown(fullText);
        this._scrollToBottom();
      }

      if (!fullText.trim()) {
        bubbleContent.innerHTML = renderMarkdown('No response generated.');
      }

      this._finalizeAssistantMessage(wrapper);
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

  _addAssistantMessageStream() {
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
        <div class="agent-answer"></div>
      </div>
    `;

    this.chatArea.appendChild(wrapper);
    this._scrollToBottom();

    const bubbleContent = wrapper.querySelector('.agent-answer');
    return { wrapper, bubbleContent };
  }

  _finalizeAssistantMessage(wrapper) {
    const bubble = wrapper.querySelector('.msg-bubble');
    if (bubble && !bubble.querySelector('.msg-time')) {
      const timeEl = document.createElement('div');
      timeEl.className = 'msg-time';
      timeEl.textContent = formatTime();
      bubble.appendChild(timeEl);
    }
    this._scrollToBottom();
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