# Caption — Chrome extension

Load local **SRT** subtitle files onto videos in the browser. Works on YouTube, Bilibili, and any page with an HTML5 `<video>` element.

## Features

- Overlay subtitles synced with video play, pause, and seek
- **Side panel** cue list: search, click to jump, highlight current cue
- **Delay offset**: adjust timing with ±0.1s / ±0.5s buttons

## Install (unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder (`caption`)
4. Pin the extension if you like

## Use

1. Open a page with a video (e.g. YouTube)
2. Click the **Caption** extension icon → side panel opens
3. **Load .srt** and pick your subtitle file
4. Play the video — subtitles appear on the player
5. Use the cue list to jump; use **Delay** buttons if audio and text are out of sync

### Delay semantics

- **Positive offset** (+): subtitles appear *later* (text lags behind the video)
- **Negative offset** (−): subtitles appear *earlier*

## Local test page

Open `test/test.html` in Chrome (file URL or via a simple static server). Load a sample `.srt` next to your test video.

## Permissions

- `sidePanel`, `activeTab`, `scripting`
- Host access for YouTube, Bilibili, and all URLs (for generic `<video>` sites)

## Project layout

```
manifest.json
src/
  background/service-worker.js
  content/content.js
  lib/srt-parser.js
  lib/subtitle-renderer.js
  sidepanel/
  shared/messages.js
test/test.html
```

## Licence

MIT (add your own licence file if needed).
