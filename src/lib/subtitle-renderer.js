/**
 * Renders subtitle overlay on a video element.
 */
class SubtitleRenderer {
  /**
   * @param {HTMLVideoElement} video
   * @param {object} options
   * @param {(state: object) => void} [options.onStateChange]
   */
  constructor(video, options = {}) {
    this.video = video;
    this.onStateChange = options.onStateChange || (() => {});
    this.cues = [];
    this.offsetSec = 0;
    this.overlay = null;
    this.textEl = null;
    this.container = null;
    this.lastStateSent = 0;
    this.stateThrottleMs = 250;

    this._onTimeUpdate = this._onTimeUpdate.bind(this);
    this._onPlay = this._onPlay.bind(this);
    this._onPause = this._onPause.bind(this);
    this._onSeeked = this._onSeeked.bind(this);
  }

  /**
   * @param {Array<{ startSec: number, endSec: number, lines: string[] }>} cues
   */
  setCues(cues) {
    this.cues = cues || [];
    this.refresh();
  }

  /** @param {number} offsetSec */
  setOffset(offsetSec) {
    this.offsetSec = Number(offsetSec) || 0;
    this.refresh();
  }

  mount() {
    if (this.overlay) return;

    const container = this._findContainer();
    this.container = container;

    const overlay = document.createElement('div');
    overlay.className = 'caption-ext-overlay';
    overlay.setAttribute('data-caption-ext', 'overlay');

    const textEl = document.createElement('div');
    textEl.className = 'caption-ext-text';
    overlay.appendChild(textEl);

    const style = document.createElement('style');
    style.textContent = `
      .caption-ext-overlay {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 8%;
        display: flex;
        justify-content: center;
        align-items: flex-end;
        pointer-events: none;
        z-index: 2147483646;
        padding: 0 5%;
        box-sizing: border-box;
      }
      .caption-ext-text {
        color: #fff;
        font-size: clamp(14px, 2.2vw, 22px);
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        font-weight: 600;
        line-height: 1.35;
        text-align: center;
        text-shadow:
          0 0 2px #000,
          0 0 4px #000,
          1px 1px 2px #000,
          -1px -1px 2px #000;
        white-space: pre-wrap;
        max-width: 90%;
      }
    `;

    if (!document.getElementById('caption-ext-styles')) {
      style.id = 'caption-ext-styles';
      document.head.appendChild(style);
    }

    const pos = getComputedStyle(container);
    if (pos.position === 'static') {
      container.style.position = 'relative';
    }

    container.appendChild(overlay);
    this.overlay = overlay;
    this.textEl = textEl;

    this.video.addEventListener('timeupdate', this._onTimeUpdate);
    this.video.addEventListener('play', this._onPlay);
    this.video.addEventListener('pause', this._onPause);
    this.video.addEventListener('seeked', this._onSeeked);

    this.refresh();
  }

  unmount() {
    if (!this.video) return;

    this.video.removeEventListener('timeupdate', this._onTimeUpdate);
    this.video.removeEventListener('play', this._onPlay);
    this.video.removeEventListener('pause', this._onPause);
    this.video.removeEventListener('seeked', this._onSeeked);

    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    this.overlay = null;
    this.textEl = null;
    this.container = null;
    this.cues = [];
  }

  refresh() {
    if (!this.video || !this.textEl) return;

    const effectiveTime = this.video.currentTime - this.offsetSec;
    const index = findActiveCueIndex(this.cues, effectiveTime);

    if (index >= 0) {
      this.textEl.textContent = this.cues[index].lines.join('\n');
    } else {
      this.textEl.textContent = '';
    }

    this._emitState(false);
  }

  /** @returns {{ currentTime: number, paused: boolean, offsetSec: number, activeIndex: number, activeCueStartSec: number, effectiveTime: number, locateCueStartSec: number }} */
  getState() {
    const effectiveTime = this.video.currentTime - this.offsetSec;
    const activeIndex = findActiveCueIndex(this.cues, effectiveTime);
    const activeCueStartSec =
      activeIndex >= 0 ? this.cues[activeIndex].startSec : -1;
    const nextIndex =
      activeIndex < 0 && this.cues.length
        ? findNextCueIndex(this.cues, effectiveTime)
        : -1;
    const locateCueStartSec =
      activeCueStartSec >= 0
        ? activeCueStartSec
        : nextIndex >= 0
          ? this.cues[nextIndex].startSec
          : -1;
    return {
      currentTime: this.video.currentTime,
      paused: this.video.paused,
      offsetSec: this.offsetSec,
      activeIndex,
      activeCueStartSec,
      effectiveTime,
      locateCueStartSec,
      cueCount: this.cues.length,
    };
  }

  _findContainer() {
    let el = this.video.parentElement;
    while (el && el !== document.body) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return el;
      }
      el = el.parentElement;
    }
    return this.video.parentElement || document.body;
  }

  _onTimeUpdate() {
    if (this.video.paused) return;
    this.refresh();
  }

  _onPlay() {
    this.refresh();
  }

  _onPause() {
    this.refresh();
  }

  _onSeeked() {
    this.refresh();
    this._emitState(true);
  }

  /** @param {boolean} force */
  _emitState(force) {
    const now = Date.now();
    if (!force && now - this.lastStateSent < this.stateThrottleMs) return;
    this.lastStateSent = now;
    this.onStateChange(this.getState());
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.SubtitleRenderer = SubtitleRenderer;
}
