(function () {
  const MSG = globalThis.CAPTION_MSG || {
    SUBTITLE_LOAD: 'SUBTITLE_LOAD',
    SUBTITLE_CLEAR: 'SUBTITLE_CLEAR',
    SUBTITLE_SEEK: 'SUBTITLE_SEEK',
    SUBTITLE_SET_OFFSET: 'SUBTITLE_SET_OFFSET',
    SUBTITLE_GET_STATE: 'SUBTITLE_GET_STATE',
    SUBTITLE_STATUS: 'SUBTITLE_STATUS',
    SUBTITLE_STATE: 'SUBTITLE_STATE',
  };

  /** @type {SubtitleRenderer | null} */
  let renderer = null;
  /** @type {Array<{ index: number, startSec: number, endSec: number, lines: string[] }>} */
  let cues = [];
  let offsetSec = 0;
  /** @type {HTMLVideoElement | null} */
  let boundVideo = null;

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

  function teardown() {
    if (renderer) {
      renderer.unmount();
      renderer = null;
    }
    boundVideo = null;
    cues = [];
    offsetSec = 0;
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

  function cuesPayload() {
    return cues.map((c) => ({
      index: c.index,
      startSec: c.startSec,
      endSec: c.endSec,
      preview: c.lines[0] || '',
    }));
  }

  /** @param {object} state @param {boolean} [includeCues] */
  function broadcastState(state, includeCues) {
    const payload = {
      type: MSG.SUBTITLE_STATE,
      ...state,
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

  function loadSrt(srtText) {
    const video = getVideo();
    if (!video) {
      sendStatus(false, 'No video found on this page.');
      return;
    }

    try {
      const result = parseSrt(srtText);
      cues = result.cues;
      offsetSec = 0;
      attachToVideo(video);
      renderer.setCues(cues);
      renderer.setOffset(offsetSec);
      renderer.mount();
      sendStatus(true, null, cues.length);
      broadcastState(renderer.getState(), true);
    } catch (err) {
      sendStatus(false, err instanceof Error ? err.message : String(err));
    }
  }

  function clearSubtitles() {
    teardown();
    sendStatus(true, null, 0);
    chrome.runtime.sendMessage({
      type: MSG.SUBTITLE_STATE,
      currentTime: 0,
      paused: true,
      offsetSec: 0,
      activeIndex: -1,
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
    video.currentTime = Math.max(0, startSec);
    if (renderer) renderer.refresh();
    broadcastState(renderer ? renderer.getState() : {});
  }

  function setOffset(sec) {
    offsetSec = Number(sec) || 0;
    if (renderer) {
      renderer.setOffset(offsetSec);
      broadcastState(renderer.getState());
    } else {
      chrome.runtime.sendMessage({
        type: MSG.SUBTITLE_STATE,
        offsetSec,
        activeIndex: -1,
        cueCount: cues.length,
        cues: [],
      }).catch(() => {});
    }
  }

  function replyState() {
    const video = getVideo();
    if (renderer && video) {
      broadcastState(renderer.getState(), true);
      return;
    }

    chrome.runtime.sendMessage({
      type: MSG.SUBTITLE_STATE,
      currentTime: video ? video.currentTime : 0,
      paused: video ? video.paused : true,
      offsetSec,
      activeIndex: video ? findActiveCueIndex(cues, video.currentTime - offsetSec) : -1,
      cueCount: cues.length,
      cues: cuesPayload(),
    }).catch(() => {});
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
        seekTo(message.startSec);
        sendResponse({ ok: true });
        break;
      case MSG.SUBTITLE_SET_OFFSET:
        setOffset(message.offsetSec);
        sendResponse({ ok: true });
        break;
      case MSG.SUBTITLE_GET_STATE:
        replyState();
        sendResponse({ ok: true });
        break;
      default:
        break;
    }

    return false;
  });

  function onSpaNavigation() {
    const video = findActiveVideo();
    if (!video) {
      if (cues.length === 0) teardown();
      return;
    }
    if (video !== boundVideo && cues.length > 0) {
      attachToVideo(video);
      renderer.setCues(cues);
      renderer.mount();
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
})();
