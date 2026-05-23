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
  const currentCueTimeEl = document.getElementById('currentCueTime');

  /** @type {Array<{ index: number, startSec: number, endSec: number, preview: string }>} */
  let allCues = [];
  let offsetSec = 0;
  let bilibiliMode = false;
  let activeIndex = -1;
  /** SRT timestamp (seconds) of the cue currently on screen */
  let activeCueStartSec = -1;
  /** Aligned timeline position: player time − delay */
  let effectiveTime = 0;
  /** Scroll/highlight target: active cue, or next cue after effectiveTime */
  let locateCueStartSec = -1;
  let lastScrolledStartSec = -1;
  let offsetInputFocused = false;

  const HINT_NORMAL = 'Click a cue to jump (player time = subtitle time + delay)';
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

  function formatSubtitleTimestamp(sec) {
    if (!Number.isFinite(sec)) return '—';
    const sign = sec < 0 ? '-' : '';
    const abs = Math.abs(sec);
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const s = Math.floor(abs % 60);
    const ms = Math.round((abs % 1) * 1000);
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    if (h > 0) {
      return `${sign}${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
    }
    return `${sign}${pad(m)}:${pad(s)},${pad(ms, 3)}`;
  }

  function updateCurrentCueTimeDisplay() {
    if (allCues.length === 0) {
      currentCueTimeEl.textContent = 'Subtitle time: —';
      return;
    }
    const displaySec =
      activeCueStartSec >= 0 ? activeCueStartSec : effectiveTime;
    const noCue = activeCueStartSec < 0;
    currentCueTimeEl.textContent = noCue
      ? `Subtitle time: ${formatSubtitleTimestamp(displaySec)} (no cue)`
      : `Subtitle time: ${formatSubtitleTimestamp(displaySec)}`;
  }

  function cueStartMatches(a, b) {
    return Math.abs(a - b) < 0.001;
  }

  function findCueListItemByStartSec(startSec) {
    if (startSec < 0) return null;
    for (const el of cueList.querySelectorAll('.cue-item')) {
      const t = parseFloat(el.dataset.startSec);
      if (cueStartMatches(t, startSec)) return el;
    }
    return null;
  }

  function resolveLocateStartSec() {
    if (locateCueStartSec >= 0) return locateCueStartSec;
    if (activeCueStartSec >= 0) return activeCueStartSec;
    if (!allCues.length || !globalThis.findNextCueIndex) return -1;
    const idx = findNextCueIndex(allCues, effectiveTime);
    return idx >= 0 ? allCues[idx].startSec : -1;
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

      const locateSec = resolveLocateStartSec();
      if (locateSec >= 0 && cueStartMatches(cue.startSec, locateSec)) {
        li.classList.add('active');
        if (activeCueStartSec < 0) li.classList.add('active-next');
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

  function scrollToLocateTarget(force) {
    const targetSec = resolveLocateStartSec();
    if (targetSec < 0) {
      setStatus('No subtitle cues loaded.', true);
      return;
    }
    if (!force && cueStartMatches(targetSec, lastScrolledStartSec)) return;

    const el = findCueListItemByStartSec(targetSec);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: force ? 'smooth' : 'auto' });
      lastScrolledStartSec = targetSec;
      const idx = parseInt(el.dataset.index, 10);
      const isNext = activeCueStartSec < 0;
      setStatus(
        isNext
          ? `Located next cue #${idx + 1} at ${formatSubtitleTimestamp(targetSec)}.`
          : `Located #${idx + 1} at ${formatSubtitleTimestamp(targetSec)}.`
      );
    } else if (searchInput.value.trim()) {
      setStatus('Cue is hidden by search — clear search and try again.', true);
    } else {
      setStatus('Could not find cue in list.', true);
    }
  }

  async function locateCurrentCue() {
    const res = await sendToContent({ type: MSG.SUBTITLE_GET_STATE });
    if (res && typeof res.activeCueStartSec === 'number') {
      applyState(res);
    }
    lastScrolledStartSec = -1;
    if (searchInput.value.trim()) {
      searchInput.value = '';
      renderCueList();
    }
    highlightActive();
    scrollToLocateTarget(true);
  }

  function applyState(state) {
    if (typeof state.offsetSec === 'number' && !offsetInputFocused) {
      offsetSec = state.offsetSec;
      syncOffsetInputFromState();
    }
    if (typeof state.activeIndex === 'number') {
      activeIndex = state.activeIndex;
    }
    if (typeof state.effectiveTime === 'number') {
      effectiveTime = state.effectiveTime;
    }
    if (typeof state.activeCueStartSec === 'number') {
      activeCueStartSec = state.activeCueStartSec;
    }
    if (typeof state.locateCueStartSec === 'number') {
      const locateChanged = state.locateCueStartSec !== locateCueStartSec;
      locateCueStartSec = state.locateCueStartSec;
      if (locateChanged) lastScrolledStartSec = -1;
    }
    if (
      typeof state.effectiveTime === 'number' ||
      typeof state.activeCueStartSec === 'number' ||
      typeof state.locateCueStartSec === 'number'
    ) {
      updateCurrentCueTimeDisplay();
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
      highlightActive();
      autoScrollToLocateTarget();
    } else {
      highlightActive();
      autoScrollToLocateTarget();
    }
  }

  function autoScrollToLocateTarget() {
    if (allCues.length === 0) return;
    scrollToLocateTarget(false);
  }

  function highlightActive() {
    const locateSec = resolveLocateStartSec();
    cueList.querySelectorAll('.cue-item').forEach((el) => {
      const startSec = parseFloat(el.dataset.startSec);
      const isLocate = locateSec >= 0 && cueStartMatches(startSec, locateSec);
      el.classList.toggle('active', isLocate);
      el.classList.toggle('active-next', isLocate && activeCueStartSec < 0);
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
    activeCueStartSec = -1;
    effectiveTime = 0;
    locateCueStartSec = -1;
    lastScrolledStartSec = -1;
    offsetSec = 0;
    syncOffsetInputFromState();
    updateCurrentCueTimeDisplay();
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
    lastScrolledStartSec = -1;
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
    updateCurrentCueTimeDisplay();
    await restoreSidepanelFromStorage();
    const res = await sendToContent({ type: MSG.SUBTITLE_GET_STATE });
    if (res) applyState(res);
  })();
})();
