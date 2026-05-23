(function () {
  const MSG = globalThis.CAPTION_MSG || {
    SUBTITLE_LOAD: 'SUBTITLE_LOAD',
    SUBTITLE_CLEAR: 'SUBTITLE_CLEAR',
    SUBTITLE_SEEK: 'SUBTITLE_SEEK',
    SUBTITLE_SET_OFFSET: 'SUBTITLE_SET_OFFSET',
    SUBTITLE_SET_BILIBILI_MODE: 'SUBTITLE_SET_BILIBILI_MODE',
    SUBTITLE_GET_STATE: 'SUBTITLE_GET_STATE',
    SUBTITLE_STATUS: 'SUBTITLE_STATUS',
    SUBTITLE_STATE: 'SUBTITLE_STATE',
  };

  /** @type {SubtitleRenderer | null} */
  let renderer = null;
  /** @type {Array<{ index: number, startSec: number, endSec: number, lines: string[] }>} */
  let cues = [];
  let offsetSec = 0;
  let bilibiliMode = false;
  /** @type {string | null} */
  let cachedSrtText = null;
  /** @type {HTMLVideoElement | null} */
  let boundVideo = null;

  let restoreAttempts = 0;
  const MAX_RESTORE_ATTEMPTS = 120;

  function findActiveVideo() {
    const videos = [...document.querySelectorAll('video')];
    return (
      videos.find((v) => !v.paused && v.readyState >= 2) ??
      videos.find((v) => v.readyState >= 2) ??
      videos[0] ??
      null
    );
  }

  function getVideo() {
    const v = findActiveVideo();
    if (v && v !== boundVideo) {
      attachToVideo(v);
    }
    return boundVideo || v;
  }

  function mountRendererIfReady() {
    const video = findActiveVideo();
    if (!video || cues.length === 0) return;
    attachToVideo(video);
    renderer.setCues(cues);
    renderer.setOffset(offsetSec);
    renderer.mount();
  }

  function teardown() {
    if (renderer) {
      renderer.unmount();
      renderer = null;
    }
    boundVideo = null;
    cues = [];
    cachedSrtText = null;
    offsetSec = 0;
    bilibiliMode = false;
  }

  function attachToVideo(video) {
    if (boundVideo === video && renderer) return;

    if (renderer) {
      renderer.unmount();
      renderer = null;
    }

    boundVideo = video;
    renderer = new SubtitleRenderer(video, {
      onStateChange: (state) => broadcastState(state),
    });
    renderer.setOffset(offsetSec);
    if (cues.length > 0) {
      renderer.setCues(cues);
      renderer.mount();
    }
  }

  async function persistSettings() {
    if (!cachedSrtText || !globalThis.saveCaptionStorage) return;
    await saveCaptionStorage({
      srt: cachedSrtText,
      offsetSec,
      bilibiliMode,
    });
  }

  function cuesPayload() {
    return cues.map((c) => ({
      index: c.index,
      startSec: c.startSec,
      endSec: c.endSec,
      preview: c.lines[0] || '',
    }));
  }

  function withMode(state) {
    return { ...state, bilibiliMode, offsetSec };
  }

  /** @param {HTMLVideoElement | null} video */
  function computeCueSync(video) {
    const effectiveTime =
      video && cues.length ? video.currentTime - offsetSec : 0;
    const activeIndex =
      video && cues.length ? findActiveCueIndex(cues, effectiveTime) : -1;
    const activeCueStartSec =
      activeIndex >= 0 ? cues[activeIndex].startSec : -1;
    const nextIndex =
      activeIndex < 0 && cues.length
        ? findNextCueIndex(cues, effectiveTime)
        : -1;
    const locateCueStartSec =
      activeCueStartSec >= 0
        ? activeCueStartSec
        : nextIndex >= 0
          ? cues[nextIndex].startSec
          : -1;
    return { activeIndex, activeCueStartSec, effectiveTime, locateCueStartSec };
  }

  /** @param {boolean} [includeCues] */
  function buildPlaybackState(includeCues) {
    const video = getVideo() || findActiveVideo();
    const { activeIndex, activeCueStartSec, effectiveTime, locateCueStartSec } =
      computeCueSync(video);
    const state = {
      currentTime: video ? video.currentTime : 0,
      paused: video ? video.paused : true,
      activeIndex,
      activeCueStartSec,
      effectiveTime,
      locateCueStartSec,
      cueCount: cues.length,
    };
    if (includeCues) {
      state.cues = cuesPayload();
    }
    return withMode(state);
  }

  /** @param {object} state @param {boolean} [includeCues] */
  function broadcastState(state, includeCues) {
    const payload = {
      type: MSG.SUBTITLE_STATE,
      ...withMode(state),
    };
    if (includeCues || cues.length === 0) {
      payload.cues = cuesPayload();
    }
    chrome.runtime.sendMessage(payload).catch(() => {});
  }

  function sendStatus(ok, error, cueCount) {
    chrome.runtime.sendMessage({
      type: MSG.SUBTITLE_STATUS,
      ok,
      error: error || null,
      cueCount: cueCount ?? cues.length,
    }).catch(() => {});
  }

  /**
   * @param {string} srtText
   * @param {{ resetOffset?: boolean, persist?: boolean, silent?: boolean }} [options]
   */
  function applySrt(srtText, options = {}) {
    const { resetOffset = false, persist = true, silent = false } = options;

    try {
      const result = parseSrt(srtText);
      cues = result.cues;
      cachedSrtText = srtText;
      if (resetOffset) offsetSec = 0;

      mountRendererIfReady();

      if (persist) persistSettings();

      if (!silent) {
        sendStatus(true, null, cues.length);
      }

      broadcastState(
        renderer ? renderer.getState() : buildPlaybackState(false),
        true
      );
      return true;
    } catch (err) {
      if (!silent) {
        sendStatus(false, err instanceof Error ? err.message : String(err));
      }
      return false;
    }
  }

  function loadSrt(srtText) {
    const hadVideo = Boolean(findActiveVideo());
    const ok = applySrt(srtText, { resetOffset: true, persist: true });
    if (!ok) return;
    if (!hadVideo && !findActiveVideo()) {
      sendStatus(true, null, cues.length);
    }
  }

  async function clearSubtitles() {
    teardown();
    if (globalThis.clearCaptionStorage) {
      await clearCaptionStorage();
    }
    sendStatus(true, null, 0);
    chrome.runtime.sendMessage({
      type: MSG.SUBTITLE_STATE,
      currentTime: 0,
      paused: true,
      offsetSec: 0,
      bilibiliMode: false,
      activeIndex: -1,
      activeCueStartSec: -1,
      effectiveTime: 0,
      locateCueStartSec: -1,
      cueCount: 0,
      cues: [],
    }).catch(() => {});
  }

  function seekTo(startSec) {
    const video = getVideo();
    if (!video) {
      sendStatus(false, 'No video found on this page.');
      return;
    }
    const targetTime = startSec + offsetSec;
    video.currentTime = Math.max(0, targetTime);
    if (renderer) renderer.refresh();
    broadcastState(renderer ? renderer.getState() : {});
  }

  function syncCueToPlayback(startSec) {
    const video = getVideo();
    if (!video) {
      sendStatus(false, 'No video found on this page.');
      return;
    }
    offsetSec = Math.round((video.currentTime - startSec) * 1000) / 1000;
    setOffset(offsetSec);
  }

  function handleCueClick(startSec) {
    if (bilibiliMode) {
      syncCueToPlayback(startSec);
    } else {
      seekTo(startSec);
    }
  }

  function setBilibiliMode(enabled) {
    bilibiliMode = Boolean(enabled);
    persistSettings();
    broadcastState(renderer ? renderer.getState() : buildPlaybackState(false));
  }

  function setOffset(sec) {
    offsetSec = Number(sec) || 0;
    if (renderer) {
      renderer.setOffset(offsetSec);
      broadcastState(renderer.getState());
    } else {
      chrome.runtime.sendMessage({
        type: MSG.SUBTITLE_STATE,
        ...buildPlaybackState(cues.length > 0),
      }).catch(() => {});
    }
    persistSettings();
  }

  function replyState() {
    const state = buildPlaybackState(true);
    broadcastState(state, true);
    return state;
  }

  async function restoreFromStorage() {
    if (!globalThis.loadCaptionStorage) return;

    const saved = await loadCaptionStorage();
    if (!saved?.srt) return;

    offsetSec = saved.offsetSec ?? 0;
    bilibiliMode = saved.bilibiliMode ?? false;

    const video = findActiveVideo();
    if (!video) {
      applySrt(saved.srt, { resetOffset: false, persist: false, silent: true });
      if (restoreAttempts < MAX_RESTORE_ATTEMPTS) {
        restoreAttempts += 1;
        setTimeout(restoreFromStorage, 500);
      }
      return;
    }

    restoreAttempts = 0;
    applySrt(saved.srt, { resetOffset: false, persist: false, silent: true });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message?.type;

    switch (type) {
      case MSG.SUBTITLE_LOAD:
        loadSrt(message.srt);
        sendResponse({ ok: true });
        break;
      case MSG.SUBTITLE_CLEAR:
        clearSubtitles();
        sendResponse({ ok: true });
        break;
      case MSG.SUBTITLE_SEEK:
        handleCueClick(message.startSec);
        sendResponse({ ok: true });
        break;
      case MSG.SUBTITLE_SET_OFFSET:
        setOffset(message.offsetSec);
        sendResponse({ ok: true });
        break;
      case MSG.SUBTITLE_SET_BILIBILI_MODE:
        setBilibiliMode(message.enabled);
        sendResponse({ ok: true });
        break;
      case MSG.SUBTITLE_GET_STATE:
        sendResponse({ ok: true, ...replyState() });
        break;
      default:
        break;
    }

    return false;
  });

  function onSpaNavigation() {
    const video = findActiveVideo();
    if (!video) return;

    if (cues.length > 0) {
      if (video !== boundVideo || !renderer) {
        attachToVideo(video);
        renderer.setCues(cues);
        renderer.setOffset(offsetSec);
        renderer.mount();
        broadcastState(renderer.getState(), true);
      }
      return;
    }

    if (cachedSrtText && globalThis.loadCaptionStorage) {
      restoreFromStorage();
    }
  }

  let moTimer = null;
  const observer = new MutationObserver(() => {
    if (moTimer) return;
    moTimer = setTimeout(() => {
      moTimer = null;
      onSpaNavigation();
    }, 500);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('yt-navigate-finish', onSpaNavigation);
  window.addEventListener('popstate', onSpaNavigation);

  restoreFromStorage();
})();
