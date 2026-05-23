/**
 * Parse SRT subtitle text into cues.
 * @param {string} text
 * @returns {{ cues: Array<{ index: number, startSec: number, endSec: number, lines: string[] }> }}
 * @throws {Error}
 */
function parseSrt(text) {
  if (!text || !String(text).trim()) {
    throw new Error('Subtitle file is empty.');
  }

  const normalised = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const blocks = normalised.split(/\n\n+/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd());
    if (lines.length < 2) continue;

    let timeLineIndex = 0;
    const first = lines[0];
    if (/^\d+$/.test(first) && lines.length >= 2) {
      timeLineIndex = 1;
    }

    const timeLine = lines[timeLineIndex];
    const match = timeLine.match(
      /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/
    );

    if (!match) {
      if (cues.length === 0 && blocks.length === 1) {
        throw new Error('Invalid SRT: could not find a timestamp line.');
      }
      continue;
    }

    const startSec = timestampToSec(match[1], match[2], match[3], match[4]);
    const endSec = timestampToSec(match[5], match[6], match[7], match[8]);

    if (endSec < startSec) {
      throw new Error(`Invalid SRT: end before start at cue ${cues.length + 1}.`);
    }

    const textLines = lines.slice(timeLineIndex + 1).filter((l) => l.length > 0);
    if (textLines.length === 0) continue;

    cues.push({
      index: cues.length + 1,
      startSec,
      endSec,
      lines: textLines,
    });
  }

  if (cues.length === 0) {
    throw new Error('No subtitle cues found in file.');
  }

  return { cues };
}

/**
 * @param {string} h
 * @param {string} m
 * @param {string} s
 * @param {string} msRaw
 */
function timestampToSec(h, m, s, msRaw) {
  const ms = msRaw.padEnd(3, '0').slice(0, 3);
  return (
    parseInt(h, 10) * 3600 +
    parseInt(m, 10) * 60 +
    parseInt(s, 10) +
    parseInt(ms, 10) / 1000
  );
}

/**
 * Find active cue index for effective playback time.
 * @param {Array<{ startSec: number, endSec: number }>} cues
 * @param {number} effectiveTime
 * @returns {number} index or -1
 */
function findActiveCueIndex(cues, effectiveTime) {
  if (!cues || cues.length === 0) return -1;

  let lo = 0;
  let hi = cues.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid];
    if (effectiveTime < cue.startSec) {
      hi = mid - 1;
    } else if (effectiveTime >= cue.endSec) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }

  return -1;
}

/**
 * First cue whose start is strictly after effectiveTime; if none, last cue.
 * @param {Array<{ startSec: number }>} cues
 * @param {number} effectiveTime
 * @returns {number} index or -1
 */
function findNextCueIndex(cues, effectiveTime) {
  if (!cues || cues.length === 0) return -1;

  let lo = 0;
  let hi = cues.length - 1;
  let result = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].startSec > effectiveTime) {
      result = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  if (result >= 0) return result;
  return cues.length - 1;
}

if (typeof globalThis !== 'undefined') {
  globalThis.parseSrt = parseSrt;
  globalThis.findActiveCueIndex = findActiveCueIndex;
  globalThis.findNextCueIndex = findNextCueIndex;
}
