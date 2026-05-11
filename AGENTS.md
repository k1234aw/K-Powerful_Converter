# AGENTS.md

## Project Overview

Powerful Converter is a Windows-focused Electron desktop app for local file conversion. It converts images, PDFs, Office-style documents, audio, and video without uploading user files.

The app supports:

- Image format conversion.
- Image to PDF, including combining multiple images into one PDF.
- PDF page export to image formats.
- Word, PowerPoint, Excel, and text-like document conversion through Microsoft Office or LibreOffice.
- Audio and video conversion through bundled local FFmpeg.
- Video to audio extraction, and short video to GIF for videos up to 10 seconds.
- Batch queues, custom output folders, DPI options, file-name formatting, and conversion progress updates.
- CPU-only or automatic GPU video encoding selection in Settings.

## Repository Layout

```text
src/main/       Electron main process code and conversion service
src/preload/    Context-isolated bridge exposed to the renderer
src/renderer/   User interface HTML, CSS, and browser-side JavaScript
tests/          Smoke conversion test
README.md       Public project description and usage guide
package.json    App metadata, scripts, dependencies, and electron-builder config
```

The root-level `index.html` and `main.js` appear to be older or copied app files. The active Electron entry point in `package.json` is `src/main/main.js`.

## Important Files

- `src/main/main.js`: Creates the Electron window, handles file/folder dialogs, wires IPC handlers, and sends conversion progress back to the renderer.
- `src/preload/preload.js`: Exposes a safe `window.converter` API for selecting files, selecting output folders, starting conversions, showing messages, resolving dropped file paths, and subscribing to progress events.
- `src/main/services/conversion-service.js`: Core conversion logic. This file owns supported file detection, target normalization, output naming, PDF/image/document/media conversion, encoder selection, and batch progress handling.
- `src/renderer/renderer.js`: UI state and interactions for queues, tabs, drag-and-drop, format pickers, output settings, settings persistence, and conversion calls.
- `src/renderer/index.html`: Main app interface loaded by Electron.
- `src/renderer/styles.css`: Main app styling.
- `tests/conversion-smoke.js`: Smoke test that uses files from `test_file/` and writes output to `test_file/conversion_output`.

## Commands

```powershell
npm install
npm start
npm run smoke
npm run build
```

- `npm start` launches the Electron app.
- `npm run smoke` runs conversion smoke tests against local sample files in `test_file/`.
- `npm run build` creates a portable Windows build using `electron-builder --win portable`.

## Conversion Notes

- Image and PDF conversion mostly uses local Node dependencies such as `sharp`, `pdf-lib`, `node-poppler`, `jxl-wasm`, `@jsquash/jxl`, and `@cornerstonejs/codec-openjpeg`.
- PDF rendering uses Poppler binaries from `node-poppler`.
- Audio and video conversion uses bundled `ffmpeg-static`; no upload or separately installed FFmpeg is required.
- Video inputs support video outputs `3GP`, `AVI`, `FLV`, `GIF`, `MKV`, `MOV`, `MP4`, `OGV`, `WEBM`, `WMV`, and `TS`, plus audio outputs `AAC`, `AIFF`, `ALAC`, `AMR`, `FLAC`, `M4A`, `MP3`, `OGG`, `WAV`, and `WMA`.
- Audio inputs support audio outputs only.
- GIF output is available only for video inputs of 10 seconds or less.
- Media encoding mode is saved in Settings as `mediaEncodingMode`; `auto` probes available H.264 GPU encoders (`h264_nvenc`, `h264_qsv`, `h264_amf`) and falls back to CPU, while `cpu` forces CPU H.264.
- JPEG XL output uses `jxl-wasm` first. If large PNG encoding aborts, the converter falls back through a high-quality temporary JPEG before trying `@jsquash/jxl`; the temporary JPEG fallback flattens transparency to white.
- Office document conversion can use Microsoft Office COM automation or a local LibreOffice `soffice.exe`.
- LibreOffice is searched in common Windows install paths and through `where.exe soffice`.
- EMF output is Windows-only and uses a temporary PowerShell script plus `System.Drawing`.
- Conversion outputs are written beside the source file unless the request specifies a custom output folder.
- Output paths are made unique automatically to avoid overwriting existing files.

## Git and Ignored Files

This project is a Git repository with remote:

```text
https://github.com/k1234aw/K-Powerful_Converter.git
```

Ignored generated or local-only folders include:

- `node_modules/`
- `dist/`
- `dist-*/`
- `.asar-stage-*/`
- `test_file/`
- logs, caches, environment files, and editor/OS files

Do not commit generated build output or sample/test files from `test_file/`.

## Development Guidance

- Keep conversion behavior centralized in `src/main/services/conversion-service.js`.
- Keep Electron IPC names consistent between `src/main/main.js`, `src/preload/preload.js`, and `src/renderer/renderer.js`.
- The renderer has a browser fallback `window.converter` stub for non-Electron contexts; do not remove it unless replacing the local-preview workflow.
- Settings are stored in `localStorage` under `powerfulConverter.settings`.
- The app uses CommonJS modules, not ES modules.
- Prefer small, focused edits that match the current plain JavaScript style.
- If adding supported formats, update both the renderer format lists and the main conversion service.
- If changing conversion output behavior, update or add smoke coverage in `tests/conversion-smoke.js`.
- When changing packaged binary dependencies, update `package.json` `asarUnpack` so executables/WASM files remain accessible after build.

## Safety Rules

Do not batch-delete files or directories in this repository.

Forbidden commands include:

- `del /s`
- `rd /s`
- `rmdir /s`
- `Remove-Item -Recurse`
- `rm -rf`

When deleting is necessary, delete only one explicit file path at a time, for example:

```powershell
Remove-Item "C:\path\to\file.txt"
```

If many files need deletion, stop and ask the user to delete them manually.

## Local Environment Notes

PowerShell in this environment may print a profile execution-policy warning before command output. Git may also need `safe.directory` and `GIT_CONFIG_GLOBAL=NUL` workarounds in the Codex sandbox because of local ownership and global config permission issues.
