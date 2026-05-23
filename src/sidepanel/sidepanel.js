(function () {
  const MSG = globalThis.CAPTION_MSG;

  const fileInput = document.getElementById('fileInput');
  const clearBtn = document.getElementById('clearBtn');
  const statusEl = document.getElementById('status');
  const offsetInput = document.getElementById('offsetInput');
  const resetOffsetBtn = document.getElementById('resetOffsetBtn');
  const applyOffsetBtn = document.getElementById('applyOffsetBtn');
  const searchInput = document.getElementById('searchInput');
  const cueList = document.getElementById('cueList');
  const cueMeta = document.getElementById('cueMeta');
  const cueSection = document.querySelector('.cue-section');
  const bilibiliModeToggle = document.getElementById('bilibiliModeToggle');
  const bilibiliModeHint = document.getElementById('bilibiliModeHint');
  const locateCueBtn = document.getElementById('locateCueBtn');

  /** @type {Array<{ index: number, startSec: number, endSec: number, preview: string }>} */
  let allCues = [];
  let offsetSec = 0;
  let bilibiliMode = false;
  let activeIndex = -1;
  let lastScrolledIndex = -1;
  let offsetInputFocused = false;

  const HINT_NORMAL = 'Click a cue to jump the video';
  const HINT_BILIBILI = 'Click a cue to sync subtitles to current playback (no seek)';

  async function getActiveTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  }

  async function sendToContent(payload) {
    const tabId = await getActiveTabId();
    if (!tabId) {
      setStatus('No active tab.', true);
      return null;
    }
    try {
      return await chrome.tabs.sendMessage(tabId, payload);
    } catch {
      setStatus('Open a video page first, then reload if needed.', true);
      return null;
    }
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', Boolean(isError));
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function syncOffsetInputFromState() {
    if (offsetInputFocused) return;
    const rounded = Math.round(offsetSec * 1000) / 1000;
    offsetInput.value = String(rounded);
  }

  function parseOffsetInput() {
    const raw = offsetInput.value.trim();
    if (raw === '' || raw === '-' || raw === '+') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  async function applyOffsetFromInput() {
    const n = parseOffsetInput();
    if (n === null) {
      setStatus('Enter a valid delay in seconds.', true);
      syncOffsetInputFromState();
      return;
    }
    offsetSec = n;
    syncOffsetInputFromState();
    await sendToContent({ type: MSG.SUBTITLE_SET_OFFSET, offsetSec });
  }

  async function nudgeOffset(delta) {
    const base = parseOffsetInput() ?? offsetSec;
    offsetSec = Math.round((base + delta) * 1000) / 1000;
    syncOffsetInputFromState();
    await sendToContent({ type: MSG.SUBTITLE_SET_OFFSET, offsetSec });
  }

  function updateBilibiliModeUi() {
    bilibiliModeToggle.checked = bilibiliMode;
    bilibiliModeToggle.setAttribute('aria-checked', String(bilibiliMode));
    bilibiliModeHint.textContent = bilibiliMode ? HINT_BILIBILI : HINT_NORMAL;
  }

  function getFilteredCues() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) return allCues;
    return allCues.filter(
      (c) =>
        c.preview.toLowerCase().includes(q) ||
        String(c.index).includes(q) ||
        formatTime(c.startSec).includes(q)
    );
  }

  function renderCueList() {
    const filtered = getFilteredCues();
    cueList.innerHTML = '';

    if (allCues.length === 0) {
      cueSection.classList.add('hidden');
      cueMeta.textContent = '';
      return;
    }

    cueSection.classList.remove('hidden');
    cueMeta.textContent = searchInput.value.trim()
      ? `${filtered.length} of ${allCues.length} cues`
      : `${allCues.length} cues`;

    for (const cue of filtered) {
      const li = document.createElement('li');
      li.className = 'cue-item';
      li.dataset.index = String(cue.index - 1);
      li.dataset.startSec = String(cue.startSec);

      const realIndex = cue.index - 1;
      if (realIndex === activeIndex) {
        li.classList.add('active');
      }

      li.innerHTML = `
        <span class="cue-time"><span class="cue-index">#${cue.index}</span>${formatTime(cue.startSec)}</span>
        <span class="cue-preview">${escapeHtml(cue.preview)}</span>
      `;

      li.addEventListener('click', () => {
        sendToContent({ type: MSG.SUBTITLE_SEEK, startSec: cue.startSec });
      });

      cueList.appendChild(li);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function scrollActiveIntoView(force) {
    if (activeIndex < 0) {
      setStatus('No active subtitle at current time.', true);
      return;
    }
    if (!force && activeIndex === lastScrolledIndex) return;

    const activeEl = cueList.querySelector(`[data-index="${activeIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      lastScrolledIndex = activeIndex;
      setStatus(`Located cue #${activeIndex + 1}.`);
    } else if (searchInput.value.trim()) {
      setStatus('Current cue is hidden by search — clear search and try again.', true);
    } else {
      setStatus('Could not find current cue in list.', true);
    }
  }

  function locateCurrentCue() {
    lastScrolledIndex = -1;
    highlightActive();
    scrollActiveIntoView(true);
  }

  function applyState(state) {
    if (typeof state.offsetSec === 'number' && !offsetInputFocused) {
      offsetSec = state.offsetSec;
      syncOffsetInputFromState();
    }
    if (typeof state.activeIndex === 'number') {
      const indexChanged = state.activeIndex !== activeIndex;
      activeIndex = state.activeIndex;
      if (indexChanged) lastScrolledIndex = -1;
    }
    if (typeof state.bilibiliMode === 'boolean') {
      bilibiliMode = state.bilibiliMode;
      updateBilibiliModeUi();
    }
    let cuesChanged = false;
    if (Array.isArray(state.cues)) {
      if (state.cues.length > 0) {
        allCues = state.cues;
        cuesChanged = true;
      } else if (state.cueCount === 0) {
        allCues = [];
        cuesChanged = true;
      }
    }
    if (cuesChanged) {
      renderCueList();
    } else {
      highlightActive();
    }
  }

  function highlightActive() {
    cueList.querySelectorAll('.cue-item').forEach((el) => {
      const idx = parseInt(el.dataset.index, 10);
      el.classList.toggle('active', idx === activeIndex);
    });
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const text = await file.text();
    setStatus('Loading…');
    await sendToContent({ type: MSG.SUBTITLE_LOAD, srt: text });
    fileInput.value = '';
  });

  clearBtn.addEventListener('click', async () => {
    await sendToContent({ type: MSG.SUBTITLE_CLEAR });
    allCues = [];
    activeIndex = -1;
    offsetSec = 0;
    syncOffsetInputFromState();
    renderCueList();
    setStatus('Cleared.');
  });

  document.querySelectorAll('[data-delta]').forEach((btn) => {
    btn.addEventListener('click', () => {
      nudgeOffset(parseFloat(btn.dataset.delta));
    });
  });

  resetOffsetBtn.addEventListener('click', async () => {
    offsetSec = 0;
    syncOffsetInputFromState();
    await sendToContent({ type: MSG.SUBTITLE_SET_OFFSET, offsetSec: 0 });
  });

  applyOffsetBtn.addEventListener('click', () => {
    applyOffsetFromInput();
  });

  offsetInput.addEventListener('focus', () => {
    offsetInputFocused = true;
  });

  offsetInput.addEventListener('blur', () => {
    offsetInputFocused = false;
    applyOffsetFromInput();
  });

  offsetInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      offsetInput.blur();
    }
  });

  searchInput.addEventListener('input', () => {
    lastScrolledIndex = -1;
    renderCueList();
    highlightActive();
  });

  locateCueBtn.addEventListener('click', () => {
    locateCurrentCue();
  });

  bilibiliModeToggle.addEventListener('change', async () => {
    bilibiliMode = bilibiliModeToggle.checked;
    updateBilibiliModeUi();
    await sendToContent({ type: MSG.SUBTITLE_SET_BILIBILI_MODE, enabled: bilibiliMode });
    setStatus(bilibiliMode ? 'Bilibili mode on — click a cue to sync.' : 'Bilibili mode off — click a cue to jump.');
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MSG.SUBTITLE_STATUS) {
      if (message.ok) {
        setStatus(message.cueCount ? `Loaded ${message.cueCount} cues.` : 'Ready.');
      } else {
        setStatus(message.error || 'Load failed.', true);
      }
      return;
    }

    if (message?.type === MSG.SUBTITLE_STATE) {
      applyState(message);
    }
  });

  function cuesFromParsed(parsed) {
    return parsed.map((c) => ({
      index: c.index,
      startSec: c.startSec,
      endSec: c.endSec,
      preview: c.lines[0] || '',
    }));
  }

  async function restoreSidepanelFromStorage() {
    if (!globalThis.loadCaptionStorage) return false;

    const saved = await loadCaptionStorage();
    if (!saved?.srt) return false;

    offsetSec = saved.offsetSec ?? 0;
    bilibiliMode = saved.bilibiliMode ?? false;
    syncOffsetInputFromState();
    updateBilibiliModeUi();

    try {
      const { cues: parsed } = parseSrt(saved.srt);
      allCues = cuesFromParsed(parsed);
      renderCueList();
      setStatus(`Restored ${allCues.length} cues from last session.`);
      return true;
    } catch {
      return false;
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.caption_offsetSec && !offsetInputFocused) {
      const next = changes.caption_offsetSec.newValue;
      if (typeof next === 'number') {
        offsetSec = next;
        syncOffsetInputFromState();
      }
    }
    if (changes.caption_bilibiliMode) {
      bilibiliMode = Boolean(changes.caption_bilibiliMode.newValue);
      updateBilibiliModeUi();
    }
    if (changes.caption_srt?.newValue) {
      restoreSidepanelFromStorage();
    }
    if (changes.caption_srt && changes.caption_srt.newValue === undefined) {
      allCues = [];
      renderCueList();
    }
  });

  (async function init() {
    await restoreSidepanelFromStorage();
    await sendToContent({ type: MSG.SUBTITLE_GET_STATE });
  })();
})();
