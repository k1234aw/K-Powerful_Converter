# Powerful Converter

Portable Windows file converter for images, PDFs, Office documents, audio, and video.

Powerful Converter is an Electron desktop app that runs conversions locally on your computer. It supports batch file conversion, image-to-PDF workflows, PDF page export, audio/video transcoding, custom output folders, file-name formatting, and Office document conversion through Microsoft Office or a local LibreOffice install.

## Features

- Convert images between common formats including PNG, JPG, GIF, TIFF, BMP, WebP, ICO, AVIF, JPEG 2000, JPEG XL, SVG, and EMF.
- Convert images to individual PDFs or combine multiple images into one PDF.
- Convert PDF pages to image formats.
- Convert Word, PowerPoint, Excel, and text-like documents to PDF or related document formats when Microsoft Office or LibreOffice is installed.
- Convert video between 3GP, AVI, FLV, MKV, MOV, MP4, OGV, WebM, WMV, and TS, create GIFs from videos up to 10 seconds, or extract video audio to supported audio formats.
- Convert audio between AAC, AIFF, ALAC, AMR, FLAC, M4A, MP3, OGG, WAV, and WMA.
- Choose automatic GPU video encoding when available, or force CPU-only encoding in Settings.
- Choose the output folder, keep files beside the original, and customize output file names.
- Run everything locally without uploading files.

## Requirements

- Windows
- Node.js and npm for development
- Microsoft Office or LibreOffice for Office document conversion

Image, PDF, audio, and video conversions are handled by bundled Node dependencies. Office document conversion depends on locally installed Office applications or LibreOffice `soffice`.

## Install

```powershell
npm install
```

## Run

```powershell
npm start
```

## Test

```powershell
npm run smoke
```

## Build

```powershell
npm run build
```

The build script creates a portable Windows app with `electron-builder`.

## Project Structure

```text
src/main/       Electron main process and conversion services
src/preload/    Secure bridge between Electron and the renderer
src/renderer/   App interface
tests/          Smoke tests
```

