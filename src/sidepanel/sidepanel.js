(function () {
  const MSG = globalThis.CAPTION_MSG;

  const fileInput = document.getElementById('fileInput');
  const clearBtn = document.getElementById('clearBtn');
  const statusEl = document.getElementById('status');
  const offsetDisplay = document.getElementById('offsetDisplay');
  const resetOffsetBtn = document.getElementById('resetOffsetBtn');
  const searchInput = document.getElementById('searchInput');
  const cueList = document.getElementById('cueList');
  const cueMeta = document.getElementById('cueMeta');
  const cueSection = document.querySelector('.cue-section');

  /** @type {Array<{ index: number, startSec: number, endSec: number, preview: string }>} */
  let allCues = [];
  let offsetSec = 0;
  let activeIndex = -1;
  let lastScrolledIndex = -1;

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

  function formatOffset(sec) {
    const sign = sec > 0 ? '+' : '';
    return `${sign}${sec.toFixed(1)}s`;
  }

  function updateOffsetDisplay() {
    offsetDisplay.textContent = formatOffset(offsetSec);
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

    scrollActiveIntoView();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function scrollActiveIntoView() {
    if (activeIndex < 0 || activeIndex === lastScrolledIndex) return;
    const activeEl = cueList.querySelector(`[data-index="${activeIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      lastScrolledIndex = activeIndex;
    }
  }

  function applyState(state) {
    if (typeof state.offsetSec === 'number') {
      offsetSec = state.offsetSec;
      updateOffsetDisplay();
    }
    if (typeof state.activeIndex === 'number') {
      activeIndex = state.activeIndex;
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
    scrollActiveIntoView();
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
    updateOffsetDisplay();
    renderCueList();
    setStatus('Cleared.');
  });

  document.querySelectorAll('[data-delta]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const delta = parseFloat(btn.dataset.delta);
      offsetSec = Math.round((offsetSec + delta) * 10) / 10;
      offsetSec = Math.max(-30, Math.min(30, offsetSec));
      updateOffsetDisplay();
      await sendToContent({ type: MSG.SUBTITLE_SET_OFFSET, offsetSec });
    });
  });

  resetOffsetBtn.addEventListener('click', async () => {
    offsetSec = 0;
    updateOffsetDisplay();
    await sendToContent({ type: MSG.SUBTITLE_SET_OFFSET, offsetSec: 0 });
  });

  searchInput.addEventListener('input', () => {
    lastScrolledIndex = -1;
    renderCueList();
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

  updateOffsetDisplay();
  sendToContent({ type: MSG.SUBTITLE_GET_STATE });
})();
