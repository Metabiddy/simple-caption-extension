const CAPTION_STORAGE_KEYS = {
  SRT: 'caption_srt',
  OFFSET: 'caption_offsetSec',
  BILIBILI_MODE: 'caption_bilibiliMode',
};

/**
 * @returns {Promise<{ srt?: string, offsetSec?: number, bilibiliMode?: boolean } | null>}
 */
async function loadCaptionStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        CAPTION_STORAGE_KEYS.SRT,
        CAPTION_STORAGE_KEYS.OFFSET,
        CAPTION_STORAGE_KEYS.BILIBILI_MODE,
      ],
      (data) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (!data[CAPTION_STORAGE_KEYS.SRT]) {
          resolve(null);
          return;
        }
        resolve({
          srt: data[CAPTION_STORAGE_KEYS.SRT],
          offsetSec: data[CAPTION_STORAGE_KEYS.OFFSET] ?? 0,
          bilibiliMode: Boolean(data[CAPTION_STORAGE_KEYS.BILIBILI_MODE]),
        });
      }
    );
  });
}

/**
 * @param {{ srt: string, offsetSec: number, bilibiliMode: boolean }} state
 */
async function saveCaptionStorage(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [CAPTION_STORAGE_KEYS.SRT]: state.srt,
        [CAPTION_STORAGE_KEYS.OFFSET]: state.offsetSec,
        [CAPTION_STORAGE_KEYS.BILIBILI_MODE]: state.bilibiliMode,
      },
      () => resolve()
    );
  });
}

async function clearCaptionStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(
      [
        CAPTION_STORAGE_KEYS.SRT,
        CAPTION_STORAGE_KEYS.OFFSET,
        CAPTION_STORAGE_KEYS.BILIBILI_MODE,
      ],
      () => resolve()
    );
  });
}

if (typeof globalThis !== 'undefined') {
  globalThis.loadCaptionStorage = loadCaptionStorage;
  globalThis.saveCaptionStorage = saveCaptionStorage;
  globalThis.clearCaptionStorage = clearCaptionStorage;
}
