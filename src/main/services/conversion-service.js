const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const ffmpegPath = require("ffmpeg-static");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const { Poppler } = require("node-poppler");
const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".tiff",
  ".tif",
  ".bmp",
  ".webp",
  ".ico",
  ".avif",
  ".jp2",
  ".j2k",
  ".j2c",
  ".jpx",
  ".jxl",
  ".svg",
  ".svgz",
  ".emf",
  ".raw",
  ".dng",
  ".proraw",
  ".cr2",
  ".cr3",
  ".nef",
  ".nrw",
  ".arw",
  ".sr2",
  ".srf",
  ".rwl",
  ".heic",
  ".heif"
]);
const PDF_EXTENSION = ".pdf";
const WORD_EXTENSIONS = new Set([".doc", ".docx", ".rtf", ".txt", ".odt"]);
const PRESENTATION_EXTENSIONS = new Set([".ppt", ".pptx"]);
const SPREADSHEET_EXTENSIONS = new Set([".xls", ".xlsx"]);
const DOCUMENT_EXTENSIONS = new Set([...WORD_EXTENSIONS, ...PRESENTATION_EXTENSIONS, ...SPREADSHEET_EXTENSIONS]);
const VIDEO_EXTENSIONS = new Set([".3gp", ".avi", ".flv", ".mkv", ".mov", ".mp4", ".ogv", ".webm", ".wmv", ".ts"]);
const AUDIO_EXTENSIONS = new Set([".aac", ".aiff", ".alac", ".amr", ".flac", ".m4a", ".mp3", ".ogg", ".wav", ".wma"]);
const WORD_TARGETS = new Set(["pdf", "doc", "docx", "rtf", "txt", "odt"]);
const PRESENTATION_TARGETS = new Set(["pdf", "ppt", "pptx"]);
const SPREADSHEET_TARGETS = new Set(["pdf", "xls", "xlsx"]);
const DOCUMENT_TARGETS = new Set([...WORD_TARGETS, ...PRESENTATION_TARGETS, ...SPREADSHEET_TARGETS]);
const OUTPUT_TARGETS = new Set(["png", "jpg", "gif", "tiff", "tif", "bmp", "webp", "ico", "avif", "jp2", "jxl", "svg", "emf"]);
const VIDEO_TARGETS = new Set(["3gp", "avi", "flv", "gif", "mkv", "mov", "mp4", "ogv", "webm", "wmv", "ts"]);
const AUDIO_TARGETS = new Set(["aac", "aiff", "alac", "amr", "flac", "m4a", "mp3", "ogg", "wav", "wma"]);
const DOCUMENT_PDF_ENGINES = new Set(["office", "libreoffice", "auto"]);
const MEDIA_ENCODING_MODES = new Set(["auto", "cpu"]);
const VIDEO_GIF_MAX_DURATION_SECONDS = 10;
let jxlEncoderPromise = null;
let openJpegPromise = null;
let ffmpegEncodersPromise = null;
let h264EncoderPromise = null;

function getKind(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }

  if (extension === PDF_EXTENSION) {
    return "pdf";
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return "document";
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }

  return "unsupported";
}

function cleanTarget(target) {
  const normalized = String(target || "").toLowerCase();
  if (normalized === "jpeg") {
    return "jpg";
  }

  if (["jpeg2000", "jpeg-2000", "j2k", "j2c", "jpx"].includes(normalized)) {
    return "jp2";
  }

  if (["jpegxl", "jpeg-xl"].includes(normalized)) {
    return "jxl";
  }

  return normalized;
}

function isSupportedTarget(kind, target) {
  if (kind === "image") {
    return target === "pdf" || OUTPUT_TARGETS.has(target);
  }

  if (kind === "pdf") {
    return target === "md" || OUTPUT_TARGETS.has(target);
  }

  if (kind === "document") {
    return OUTPUT_TARGETS.has(target) || isSupportedDocumentTarget("", target);
  }

  if (kind === "video") {
    return VIDEO_TARGETS.has(target) || AUDIO_TARGETS.has(target);
  }

  if (kind === "audio") {
    return AUDIO_TARGETS.has(target);
  }

  return false;
}

function documentFamilyForExtension(extension) {
  if (WORD_EXTENSIONS.has(extension)) {
    return "word";
  }

  if (PRESENTATION_EXTENSIONS.has(extension)) {
    return "presentation";
  }

  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return "spreadsheet";
  }

  return null;
}

function documentFamilyForTarget(target) {
  if (WORD_TARGETS.has(target) && target !== "pdf") {
    return "word";
  }

  if (PRESENTATION_TARGETS.has(target) && target !== "pdf") {
    return "presentation";
  }

  if (SPREADSHEET_TARGETS.has(target) && target !== "pdf") {
    return "spreadsheet";
  }

  return target === "pdf" ? "pdf" : null;
}

function isSupportedDocumentTarget(filePath, target) {
  if (target === "pdf") {
    return true;
  }

  const targetFamily = documentFamilyForTarget(target);

  if (!filePath) {
    return Boolean(targetFamily);
  }

  return documentFamilyForExtension(path.extname(filePath).toLowerCase()) === targetFamily;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPngBuffer(buffer) {
  return buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
}

async function icoToPngBuffer(filePath) {
  const buffer = await fs.readFile(filePath);

  if (buffer.length < 22 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error("Invalid ICO file.");
  }

  const count = buffer.readUInt16LE(4);
  const entries = [];

  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;

    if (offset + 16 > buffer.length) {
      break;
    }

    const width = buffer[offset] || 256;
    const height = buffer[offset + 1] || 256;
    const bitDepth = buffer.readUInt16LE(offset + 6) || buffer.readUInt16LE(offset + 4);
    const size = buffer.readUInt32LE(offset + 8);
    const imageOffset = buffer.readUInt32LE(offset + 12);

    if (imageOffset + size <= buffer.length) {
      entries.push({ width, height, bitDepth, size, imageOffset });
    }
  }

  entries.sort((a, b) => (b.width * b.height * b.bitDepth) - (a.width * a.height * a.bitDepth));

  for (const entry of entries) {
    const imageBuffer = buffer.subarray(entry.imageOffset, entry.imageOffset + entry.size);

    if (isPngBuffer(imageBuffer)) {
      return imageBuffer;
    }

    if (imageBuffer.length >= 40 && imageBuffer.readUInt32LE(0) >= 40 && imageBuffer.readUInt16LE(14) === 32) {
      const headerSize = imageBuffer.readUInt32LE(0);
      const width = Math.abs(imageBuffer.readInt32LE(4));
      const dibHeight = Math.abs(imageBuffer.readInt32LE(8));
      const height = Math.max(1, Math.floor(dibHeight / 2));
      const pixelOffset = headerSize;
      const rowStride = width * 4;
      const raw = Buffer.alloc(width * height * 4);

      if (pixelOffset + rowStride * height > imageBuffer.length) {
        continue;
      }

      for (let y = 0; y < height; y += 1) {
        const sourceY = height - 1 - y;

        for (let x = 0; x < width; x += 1) {
          const source = pixelOffset + sourceY * rowStride + x * 4;
          const target = (y * width + x) * 4;

          raw[target] = imageBuffer[source + 2];
          raw[target + 1] = imageBuffer[source + 1];
          raw[target + 2] = imageBuffer[source];
          raw[target + 3] = imageBuffer[source + 3];
        }
      }

      return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
    }
  }

  throw new Error("This ICO file uses an unsupported internal image format.");
}

async function imageSharp(filePath) {
  if (path.extname(filePath).toLowerCase() === ".ico") {
    return sharp(await icoToPngBuffer(filePath), { limitInputPixels: false });
  }

  return sharp(filePath, { limitInputPixels: false });
}

async function uniquePath(candidatePath) {
  if (!(await pathExists(candidatePath))) {
    return candidatePath;
  }

  const parsed = path.parse(candidatePath);
  let index = 1;

  while (true) {
    const suffix = index === 1 ? "_converted" : `_converted-${index}`;
    const nextPath = path.join(parsed.dir, `${parsed.name}${suffix}${parsed.ext}`);

    if (!(await pathExists(nextPath))) {
      return nextPath;
    }

    index += 1;
  }
}

function outputDirectoryFor(filePath, output) {
  if (output?.mode === "custom" && output.directory) {
    return output.directory;
  }

  return path.dirname(filePath);
}

function baseNameWithoutExtension(filePath) {
  return path.parse(filePath).name;
}

function cleanFileNamePiece(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/[. ]+$/g, "");
}

function outputBaseNameFor(filePath, output) {
  const originalName = cleanFileNamePiece(baseNameWithoutExtension(filePath)) || "Converted_File";
  const format = output?.fileNameFormat;

  if (!format) {
    return originalName;
  }

  const parts = [];
  const prefix = cleanFileNamePiece(format.prefix);
  const suffix = cleanFileNamePiece(format.suffix);

  if (format.usePrefix && prefix) {
    parts.push(prefix);
  }

  if (format.useOriginal !== false) {
    parts.push(originalName);
  }

  if (format.useSuffix && suffix) {
    parts.push(suffix);
  }

  if (format.useConvertedText) {
    parts.push("Converted_File");
  }

  return cleanFileNamePiece(parts.join("")) || originalName;
}

function outputExtensionFor(target) {
  if (target === "jpg") {
    return "jpg";
  }

  if (target === "alac") {
    return "m4a";
  }

  if (target === "tif") {
    return "tif";
  }

  if (target === "jp2") {
    return "j2k";
  }

  if (target === "jxl") {
    return "jxl";
  }

  return target;
}

function popplerBinaryPath() {
  const relativePath = path.join(
    "node_modules",
    "node-poppler",
    "src",
    "lib",
    "win32",
    "poppler-24.07.0",
    "Library",
    "bin"
  );
  const packagedPath = process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked", relativePath)
    : null;

  if (packagedPath && fssync.existsSync(path.join(packagedPath, "pdftocairo.exe"))) {
    return packagedPath;
  }

  return path.join(
    path.dirname(require.resolve("node-poppler")),
    "lib",
    "win32",
    "poppler-24.07.0",
    "Library",
    "bin"
  );
}

function imagePdfDpiFromRequest(request) {
  const dpi = Number(request.imagePdfDpi || 150);

  if (Number.isNaN(dpi)) {
    return 150;
  }

  return Math.min(300, Math.max(96, Math.round(dpi)));
}

function ffmpegBinaryPath() {
  const packagedPath = process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe")
    : null;

  if (packagedPath && fssync.existsSync(packagedPath)) {
    return packagedPath;
  }

  return ffmpegPath;
}

function nodeLikeRuntimePath() {
  return process.execPath;
}

function jxlWasmWrapperPath() {
  const relativePath = path.join("node_modules", "jxl-wasm", "lib", "cjxl-wrap.js");
  const packagedPath = process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked", relativePath)
    : null;

  if (packagedPath && fssync.existsSync(packagedPath)) {
    return packagedPath;
  }

  return require.resolve("jxl-wasm/lib/cjxl-wrap.js");
}

function shortErrorMessage(error) {
  const text = String(error?.stderr || error?.message || error || "");
  const firstUsefulLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("var Module=") && !line.includes("process.argv ="));

  return (firstUsefulLine || "Unknown error").slice(0, 500);
}

function secondsFromFfmpegTime(value) {
  const match = String(value || "").match(/^(\d+):(\d+):(\d+(?:\.\d+)?)/);

  if (!match) {
    return 0;
  }

  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function mediaProgressMessage(label, seconds, durationSeconds) {
  if (!durationSeconds) {
    return `${label}...`;
  }

  const percent = Math.max(0, Math.min(99, Math.round((seconds / durationSeconds) * 100)));
  return `${label}... ${percent}%`;
}

function cleanMediaEncodingMode(mode) {
  const normalized = String(mode || "auto").toLowerCase();
  return MEDIA_ENCODING_MODES.has(normalized) ? normalized : "auto";
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function cleanMediaOptions(options = {}) {
  const videoResolution = ["original", "1440", "1080", "720"].includes(String(options.videoResolution))
    ? String(options.videoResolution)
    : "original";
  const gifResolution = ["original", "720", "640", "480", "360"].includes(String(options.gifResolution))
    ? String(options.gifResolution)
    : "640";

  return {
    videoResolution,
    gifResolution,
    gifFps: clampInteger(options.gifFps, 1, 30, 15),
    audioNormalize: Boolean(options.audioNormalize)
  };
}

function cleanImageOptions(options = {}) {
  return {
    quality: clampInteger(options.quality, 1, 100, 92)
  };
}

function downscaleVideoFilter(height) {
  if (!height || height === "original") {
    return null;
  }

  return `scale=-2:min(${height}\\,ih):flags=lanczos`;
}

async function mediaDurationSeconds(filePath) {
  try {
    await execFileAsync(ffmpegBinaryPath(), ["-hide_banner", "-i", filePath], {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const text = `${error.stderr || ""}\n${error.stdout || ""}`;
    const match = text.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);

    return match ? secondsFromFfmpegTime(match[1]) : 0;
  }

  return 0;
}

async function ffmpegEncoders() {
  if (!ffmpegEncodersPromise) {
    ffmpegEncodersPromise = execFileAsync(ffmpegBinaryPath(), ["-hide_banner", "-encoders"], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4
    })
      .then(({ stdout }) => stdout)
      .catch(() => "");
  }

  return ffmpegEncodersPromise;
}

async function bestH264Encoder() {
  if (!h264EncoderPromise) {
    h264EncoderPromise = (async () => {
      const encoders = await ffmpegEncoders();
      const candidates = ["h264_nvenc", "h264_qsv", "h264_amf"];

      for (const encoder of candidates) {
        if (!new RegExp(`\\b${encoder}\\b`).test(encoders)) {
          continue;
        }

        try {
          await execFileAsync(ffmpegBinaryPath(), [
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=size=128x128:rate=30:duration=1",
            "-frames:v",
            "1",
            "-c:v",
            encoder,
            "-f",
            "null",
            "-"
          ], {
            windowsHide: true,
            timeout: 8000,
            maxBuffer: 1024 * 1024
          });

          return encoder;
        } catch {
          // Hardware encoders can be compiled in but unavailable on this PC.
        }
      }

      return "libx264";
    })();
  }

  return h264EncoderPromise;
}

async function h264VideoArgs(encodingMode = "auto") {
  if (cleanMediaEncodingMode(encodingMode) === "cpu") {
    return {
      args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"],
      label: "CPU H.264"
    };
  }

  const encoder = await bestH264Encoder();

  if (encoder === "libx264") {
    return {
      args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"],
      label: "CPU H.264"
    };
  }

  return {
    args: ["-c:v", encoder, "-preset", "fast", "-cq", "23"],
    label: `GPU ${encoder}`
  };
}

async function videoCodecArgsFor(target, encodingMode = "auto", options = {}) {
  const mediaOptions = cleanMediaOptions(options);

  if (target === "gif") {
    const filters = [`fps=${mediaOptions.gifFps}`];
    const scaleFilter = downscaleVideoFilter(mediaOptions.gifResolution);

    if (scaleFilter) {
      filters.push(scaleFilter);
    }

    return {
      args: ["-vf", filters.join(","), "-loop", "0"],
      label: "CPU GIF"
    };
  }

  const videoFilters = [];
  const scaleFilter = downscaleVideoFilter(mediaOptions.videoResolution);

  if (scaleFilter) {
    videoFilters.push(scaleFilter);
  }

  if (target === "webm") {
    return {
      args: [...(videoFilters.length > 0 ? ["-vf", videoFilters.join(",")] : []), "-c:v", "libvpx", "-deadline", "good", "-cpu-used", "4", "-b:v", "2M", "-c:a", "libopus"],
      label: "CPU WebM"
    };
  }

  if (target === "ogv") {
    return {
      args: [...(videoFilters.length > 0 ? ["-vf", videoFilters.join(",")] : []), "-c:v", "libtheora", "-q:v", "7", "-c:a", "libvorbis", "-q:a", "5"],
      label: "CPU OGV"
    };
  }

  if (target === "wmv") {
    return {
      args: [...(videoFilters.length > 0 ? ["-vf", videoFilters.join(",")] : []), "-c:v", "wmv2", "-q:v", "4", "-c:a", "wmav2"],
      label: "CPU WMV"
    };
  }

  if (target === "avi") {
    return {
      args: [...(videoFilters.length > 0 ? ["-vf", videoFilters.join(",")] : []), "-c:v", "mpeg4", "-q:v", "4", "-c:a", "libmp3lame", "-q:a", "3"],
      label: "CPU AVI"
    };
  }

  if (target === "flv") {
    return {
      args: [...(videoFilters.length > 0 ? ["-vf", videoFilters.join(",")] : []), "-c:v", "flv", "-q:v", "4", "-c:a", "libmp3lame", "-q:a", "3"],
      label: "CPU FLV"
    };
  }

  if (target === "3gp") {
    return {
      args: ["-c:v", "libx264", "-preset", "veryfast", "-profile:v", "baseline", "-level", "3.0", ...(videoFilters.length > 0 ? ["-vf", videoFilters.join(",")] : []), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k"],
      label: "CPU 3GP"
    };
  }

  const h264 = await h264VideoArgs(encodingMode);
  return {
    args: [...h264.args, ...(videoFilters.length > 0 ? ["-vf", videoFilters.join(",")] : []), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"],
    label: h264.label
  };
}

function audioCodecArgsFor(target, options = {}) {
  const mediaOptions = cleanMediaOptions(options);
  const argsByTarget = {
    aac: ["-c:a", "aac", "-b:a", "192k"],
    aiff: ["-c:a", "pcm_s16be"],
    alac: ["-c:a", "alac"],
    amr: ["-c:a", "libopencore_amrnb", "-ar", "8000", "-ac", "1", "-b:a", "12.2k"],
    flac: ["-c:a", "flac"],
    m4a: ["-c:a", "aac", "-b:a", "192k"],
    mp3: ["-c:a", "libmp3lame", "-q:a", "2"],
    ogg: ["-c:a", "libvorbis", "-q:a", "5"],
    wav: ["-c:a", "pcm_s16le"],
    wma: ["-c:a", "wmav2", "-b:a", "192k"]
  };
  const args = [...(argsByTarget[target] || ["-c:a", "aac", "-b:a", "192k"])];

  if (mediaOptions.audioNormalize) {
    args.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11");
  }

  return {
    args,
    label: "CPU audio"
  };
}

function mediaOutputFormatArgs(target) {
  if (target === "alac") {
    return ["-f", "ipod"];
  }

  if (target === "ts") {
    return ["-f", "mpegts"];
  }

  return [];
}

function runFfmpeg(args, progressCallback = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinaryPath(), args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    let stdout = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;

      for (const line of chunk.split(/\r?\n/)) {
        const [key, value] = line.split("=");

        if (key && value !== undefined) {
          progressCallback(key.trim(), value.trim());
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      progressCallback("stderr", chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr || stdout || `FFmpeg exited with code ${code}.`));
    });
  });
}

async function convertMediaFormat(filePath, target, output, inputKind, encodingMode = "auto", options = {}, onProgress = () => {}) {
  if (typeof options === "function") {
    onProgress = options;
    options = {};
  }

  const binaryPath = ffmpegBinaryPath();

  if (!binaryPath) {
    throw new Error("Local FFmpeg binary is not available.");
  }

  const outputDir = outputDirectoryFor(filePath, output);
  const baseName = outputBaseNameFor(filePath, output);
  const outputPath = await uniquePath(path.join(outputDir, `${baseName}.${outputExtensionFor(target)}`));
  const isAudioTarget = AUDIO_TARGETS.has(target);
  const isGifTarget = target === "gif";
  const codec = isAudioTarget ? audioCodecArgsFor(target, options) : await videoCodecArgsFor(target, encodingMode, options);
  const label = codec.label || "Converting";
  let durationSeconds = 0;
  let lastPercent = -1;

  if (isGifTarget) {
    const duration = await mediaDurationSeconds(filePath);

    if (!duration) {
      throw new Error("Could not read video duration for GIF conversion.");
    }

    if (duration > VIDEO_GIF_MAX_DURATION_SECONDS) {
      throw new Error(`GIF output is only available for videos ${VIDEO_GIF_MAX_DURATION_SECONDS} seconds or shorter.`);
    }
  }

  const args = [
    "-hide_banner",
    "-y",
    "-nostats",
    "-i",
    filePath,
    "-map",
    isAudioTarget ? "0:a:0" : "0:v:0",
    ...(!isAudioTarget && !isGifTarget ? ["-map", "0:a?"] : []),
    ...(isAudioTarget ? ["-vn"] : []),
    ...(isGifTarget ? ["-an"] : []),
    ...codec.args,
    "-threads",
    "0",
    "-progress",
    "pipe:1",
    ...mediaOutputFormatArgs(target),
    outputPath
  ];

  if (inputKind === "audio" && !isAudioTarget) {
    throw new Error("Audio files can only be converted to audio formats.");
  }

  onProgress({ status: "running", message: `${label} started` });

  try {
    await runFfmpeg(args, (key, value) => {
      if (key === "stderr") {
        const durationMatch = value.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);

        if (durationMatch) {
          durationSeconds = secondsFromFfmpegTime(durationMatch[1]);
        }
        return;
      }

      if (key !== "out_time_ms" && key !== "out_time_us") {
        return;
      }

      const seconds = Number(value) / 1000000;
      const percent = durationSeconds ? Math.floor((seconds / durationSeconds) * 100) : -1;

      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress({
          status: "running",
          message: mediaProgressMessage(label, seconds, durationSeconds)
        });
      }
    });
  } catch (error) {
    const detail = error.stderr || error.message;
    throw new Error(`Local media conversion failed. ${detail}`);
  }

  return [outputPath];
}

async function convertImageFormat(filePath, target, output, options = {}) {
  const outputDir = outputDirectoryFor(filePath, output);
  const baseName = outputBaseNameFor(filePath, output);
  const outputPath = await uniquePath(path.join(outputDir, `${baseName}.${outputExtensionFor(target)}`));
  const image = (await imageSharp(filePath)).rotate();
  const imageOptions = cleanImageOptions(options);

  if (target === "png") {
    await image.png({ compressionLevel: 9 }).toFile(outputPath);
    return [outputPath];
  }

  if (target === "jpg") {
    await image.flatten({ background: "#ffffff" }).jpeg({ quality: imageOptions.quality }).toFile(outputPath);
    return [outputPath];
  }

  if (target === "gif") {
    await image.gif().toFile(outputPath);
    return [outputPath];
  }

  if (target === "tiff" || target === "tif") {
    await image.tiff({ compression: "lzw", quality: 92 }).toFile(outputPath);
    return [outputPath];
  }

  if (target === "webp") {
    await image.webp({ quality: imageOptions.quality }).toFile(outputPath);
    return [outputPath];
  }

  if (target === "avif") {
    await image.avif({ quality: 70 }).toFile(outputPath);
    return [outputPath];
  }

  if (target === "bmp") {
    await writeBmp(outputPath, filePath);
    return [outputPath];
  }

  if (target === "ico") {
    await writeIco(outputPath, filePath);
    return [outputPath];
  }

  if (target === "svg") {
    await writeSvg(outputPath, filePath);
    return [outputPath];
  }

  if (target === "jp2") {
    await writeJpeg2000(outputPath, filePath);
    return [outputPath];
  }

  if (target === "jxl") {
    await writeJpegXl(outputPath, filePath);
    return [outputPath];
  }

  if (target === "emf") {
    await writeEmf(outputPath, filePath);
    return [outputPath];
  }

  throw new Error(`Cannot convert this file to ${target.toUpperCase()}.`);
}

async function writeBmp(outputPath, filePath) {
  const { data, info } = await (await imageSharp(filePath))
    .rotate()
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rowStride = Math.ceil((info.width * 3) / 4) * 4;
  const pixelBytes = rowStride * info.height;
  const fileBytes = 54 + pixelBytes;
  const buffer = Buffer.alloc(fileBytes);

  buffer.write("BM", 0, 2, "ascii");
  buffer.writeUInt32LE(fileBytes, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(info.width, 18);
  buffer.writeInt32LE(info.height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelBytes, 34);

  for (let y = 0; y < info.height; y += 1) {
    const sourceY = info.height - 1 - y;
    const targetRow = 54 + y * rowStride;

    for (let x = 0; x < info.width; x += 1) {
      const source = (sourceY * info.width + x) * info.channels;
      const target = targetRow + x * 3;

      buffer[target] = data[source + 2];
      buffer[target + 1] = data[source + 1];
      buffer[target + 2] = data[source];
    }
  }

  await fs.writeFile(outputPath, buffer);
}

async function writeIco(outputPath, filePath) {
  const pngBuffer = await (await imageSharp(filePath))
    .rotate()
    .resize(256, 256, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const header = Buffer.alloc(22);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 0;
  header[7] = 0;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngBuffer.length, 14);
  header.writeUInt32LE(header.length, 18);

  await fs.writeFile(outputPath, Buffer.concat([header, pngBuffer]));
}

async function writeSvg(outputPath, filePath) {
  const { data, info } = await (await imageSharp(filePath))
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  const encoded = data.toString("base64");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}" viewBox="0 0 ${info.width} ${info.height}">`,
    `<image width="${info.width}" height="${info.height}" href="data:image/png;base64,${encoded}"/>`,
    "</svg>"
  ].join("");

  await fs.writeFile(outputPath, svg);
}

async function jxlEncoder() {
  if (!jxlEncoderPromise) {
    jxlEncoderPromise = (async () => {
      const packageRoot = path.dirname(require.resolve("@jsquash/jxl/package.json"));
      const wasmPath = path.join(packageRoot, "codec", "enc", "jxl_enc.wasm");
      const encoder = await import("@jsquash/jxl/encode.js");
      const wasm = await fs.readFile(wasmPath);

      await encoder.init(await WebAssembly.compile(wasm));
      return encoder.default;
    })();
  }

  return jxlEncoderPromise;
}

async function writeJpegXl(outputPath, filePath) {
  const failures = [];

  try {
    await writeJpegXlWithCjxlWasm(outputPath, filePath);
    return;
  } catch (cjxlError) {
    failures.push(`cjxl-wasm PNG path: ${shortErrorMessage(cjxlError)}`);
  }

  try {
    await writeJpegXlWithJpegIntermediate(outputPath, filePath);
    return;
  } catch (jpegFallbackError) {
    failures.push(`JPEG fallback: ${shortErrorMessage(jpegFallbackError)}`);
  }

  try {
    await writeJpegXlWithJsquash(outputPath, filePath);
    return;
  } catch (jsquashError) {
    failures.push(`@jsquash/jxl: ${shortErrorMessage(jsquashError)}`);
  }

  throw new Error(`JPEG XL conversion failed locally. ${failures.join(" ")}`);
}

async function writeJpegXlWithCjxlWasm(outputPath, filePath) {
  const tempPng = await uniquePath(path.join(
    path.dirname(outputPath),
    `${baseNameWithoutExtension(outputPath)}_jxl_source.png`
  ));

  try {
    await (await imageSharp(filePath))
      .rotate()
      .png({ compressionLevel: 6 })
      .toFile(tempPng);

    await runCjxlWasm(tempPng, outputPath);

    if (!(await pathExists(outputPath))) {
      throw new Error("cjxl-wasm finished but no JPEG XL file was created.");
    }
  } finally {
    try {
      await fs.unlink(tempPng);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function runCjxlWasm(inputPath, outputPath) {
  try {
    await fs.unlink(outputPath);
  } catch {
    // The output usually does not exist yet; this only removes failed partial files.
  }

  const code = [
    "global.fetch = undefined;",
    "process.argv = ['node', 'cjxl', '--quality', '90', '--effort', '3', process.env.JXL_INPUT, process.env.JXL_OUTPUT];",
    "require(process.env.JXL_CJXL_WRAP);"
  ].join("");

  try {
    await execFileAsync(nodeLikeRuntimePath(), ["-e", code], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        JXL_CJXL_WRAP: jxlWasmWrapperPath(),
        JXL_INPUT: inputPath,
        JXL_OUTPUT: outputPath
      }
    });
  } catch (error) {
    throw new Error(shortErrorMessage(error));
  }
}

async function writeJpegXlWithJpegIntermediate(outputPath, filePath) {
  const tempJpeg = await uniquePath(path.join(
    path.dirname(outputPath),
    `${baseNameWithoutExtension(outputPath)}_jxl_source.jpg`
  ));

  try {
    await (await imageSharp(filePath))
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 95, mozjpeg: true })
      .toFile(tempJpeg);

    await runCjxlWasm(tempJpeg, outputPath);

    if (!(await pathExists(outputPath))) {
      throw new Error("JPEG fallback finished but no JPEG XL file was created.");
    }
  } finally {
    try {
      await fs.unlink(tempJpeg);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function writeJpegXlWithJsquash(outputPath, filePath) {
  try {
    const encode = await jxlEncoder();
    const { data, info } = await (await imageSharp(filePath))
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const encoded = await encode(
      {
        data: new Uint8ClampedArray(data),
        width: info.width,
        height: info.height
      },
      { quality: 90, effort: 4 }
    );

    await fs.writeFile(outputPath, Buffer.from(encoded));
  } catch (error) {
    jxlEncoderPromise = null;
    throw error;
  }
}

async function openJpeg() {
  if (!openJpegPromise) {
    openJpegPromise = require("@cornerstonejs/codec-openjpeg")({
      print: () => {},
      printErr: () => {}
    });
  }

  return openJpegPromise;
}

async function writeJpeg2000(outputPath, filePath) {
  const openjpeg = await openJpeg();
  const { data, info } = await (await imageSharp(filePath))
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const encoder = new openjpeg.J2KEncoder();
  const frame = {
    width: info.width,
    height: info.height,
    bitsPerSample: 8,
    componentCount: 3,
    isSigned: false
  };
  const decodedBuffer = encoder.getDecodedBuffer(frame);

  decodedBuffer.set(data);
  encoder.setCompressionRatio(0, 10);
  encoder.encode();
  await fs.writeFile(outputPath, Buffer.from(encoder.getEncodedBuffer()));
}

async function writeEmf(outputPath, filePath) {
  if (process.platform !== "win32") {
    throw new Error("EMF output is only available on Windows.");
  }

  const outputDir = path.dirname(outputPath);
  const tempPng = await uniquePath(path.join(outputDir, `${baseNameWithoutExtension(outputPath)}_emf_source.png`));
  const tempScript = await uniquePath(path.join(outputDir, `${baseNameWithoutExtension(outputPath)}_emf_writer.ps1`));
  const script = `
param(
  [string]$Source,
  [string]$Target
)
Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Image]::FromFile($Source)
$reference = New-Object System.Drawing.Bitmap 1, 1
$graphics = [System.Drawing.Graphics]::FromImage($reference)
$hdc = $graphics.GetHdc()
$rect = New-Object System.Drawing.RectangleF 0, 0, $bitmap.Width, $bitmap.Height
$metafile = New-Object System.Drawing.Imaging.Metafile($Target, $hdc, $rect, [System.Drawing.Imaging.MetafileFrameUnit]::Pixel)
$graphics.ReleaseHdc($hdc)
$metafileGraphics = [System.Drawing.Graphics]::FromImage($metafile)
$metafileGraphics.DrawImage($bitmap, 0, 0, $bitmap.Width, $bitmap.Height)
$metafileGraphics.Dispose()
$metafile.Dispose()
$graphics.Dispose()
$reference.Dispose()
$bitmap.Dispose()
`;

  await (await imageSharp(filePath)).rotate().png().toFile(tempPng);
  await fs.writeFile(tempScript, script);

  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempScript, "-Source", tempPng, "-Target", outputPath],
      { windowsHide: true }
    );
  } finally {
    await fs.unlink(tempPng).catch(() => {});
    await fs.unlink(tempScript).catch(() => {});
  }
}

function escapePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function officePowerShellScript(sourcePath, outputPath, mode) {
  return `
$ErrorActionPreference = 'Stop'
$source = '${escapePowerShellString(sourcePath)}'
$target = '${escapePowerShellString(outputPath)}'
$mode = '${escapePowerShellString(mode)}'
$app = $null
$document = $null
try {
  if ($mode -eq 'word-to-pdf') {
    $app = New-Object -ComObject Word.Application
    $app.Visible = $false
    $document = $app.Documents.Open($source, $false, $true)
    $document.ExportAsFixedFormat($target, 17)
  } elseif ($mode -eq 'word-to-docx' -or $mode -eq 'word-to-doc' -or $mode -eq 'word-to-rtf' -or $mode -eq 'word-to-txt' -or $mode -eq 'word-to-odt') {
    $wordFormats = @{
      'word-to-doc' = 0
      'word-to-docx' = 16
      'word-to-rtf' = 6
      'word-to-txt' = 2
      'word-to-odt' = 23
    }
    $app = New-Object -ComObject Word.Application
    $app.Visible = $false
    $document = $app.Documents.Open($source, $false, $true)
    $format = $wordFormats[$mode]
    $document.SaveAs([ref]$target, [ref]$format)
  } elseif ($mode -eq 'pdf-to-docx') {
    $app = New-Object -ComObject Word.Application
    $app.Visible = $false
    $app.DisplayAlerts = 0
    $confirmConversions = $false
    $readOnly = $false
    $addToRecentFiles = $false
    $document = $app.Documents.Open([ref]$source, [ref]$confirmConversions, [ref]$readOnly, [ref]$addToRecentFiles)
    $document.SaveAs([ref]$target, [ref]16)
  } elseif ($mode -eq 'excel-to-pdf') {
    $app = New-Object -ComObject Excel.Application
    $app.Visible = $false
    $app.DisplayAlerts = $false
    $document = $app.Workbooks.Open($source, 3, $true)
    $document.ExportAsFixedFormat(0, $target)
  } elseif ($mode -eq 'excel-to-xlsx' -or $mode -eq 'excel-to-xls') {
    $excelFormats = @{
      'excel-to-xls' = 56
      'excel-to-xlsx' = 51
    }
    $app = New-Object -ComObject Excel.Application
    $app.Visible = $false
    $app.DisplayAlerts = $false
    $document = $app.Workbooks.Open($source, 3, $true)
    $document.SaveAs($target, $excelFormats[$mode])
  } elseif ($mode -eq 'powerpoint-to-pdf') {
    $app = New-Object -ComObject PowerPoint.Application
    $document = $app.Presentations.Open($source, $true, $true, $false)
    $document.SaveAs($target, 32)
  } elseif ($mode -eq 'powerpoint-to-pptx' -or $mode -eq 'powerpoint-to-ppt') {
    $powerPointFormats = @{
      'powerpoint-to-ppt' = 1
      'powerpoint-to-pptx' = 24
    }
    $app = New-Object -ComObject PowerPoint.Application
    $document = $app.Presentations.Open($source, $true, $true, $false)
    $document.SaveAs($target, $powerPointFormats[$mode])
  } else {
    throw "Unsupported document conversion mode: $mode"
  }
} finally {
  if ($document -ne $null) {
    try { $document.Close($false) } catch {}
  }
  if ($app -ne $null) {
    try { $app.Quit() } catch {}
  }
}
`;
}

function documentConversionMode(filePath, target) {
  const extension = path.extname(filePath).toLowerCase();
  const family = documentFamilyForExtension(extension);

  if (family === "word" && target === "pdf") {
    return "word-to-pdf";
  }

  if (family === "word" && WORD_TARGETS.has(target)) {
    return `word-to-${target}`;
  }

  if (extension === ".pdf" && target === "docx") {
    return "pdf-to-docx";
  }

  if (family === "spreadsheet" && target === "pdf") {
    return "excel-to-pdf";
  }

  if (family === "spreadsheet" && SPREADSHEET_TARGETS.has(target)) {
    return `excel-to-${target}`;
  }

  if (family === "presentation" && target === "pdf") {
    return "powerpoint-to-pdf";
  }

  if (family === "presentation" && PRESENTATION_TARGETS.has(target)) {
    return `powerpoint-to-${target}`;
  }

  return null;
}

function cleanDocumentPdfEngine(engine) {
  const normalized = String(engine || "office").toLowerCase();
  return DOCUMENT_PDF_ENGINES.has(normalized) ? normalized : "office";
}

async function libreOfficeBinaryPath() {
  const candidates = [
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"
  ];

  for (const candidate of candidates) {
    if (fssync.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const { stdout } = await execFileAsync("where.exe", ["soffice"], { windowsHide: true });
    const found = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (found) {
      return found;
    }
  } catch {
    return null;
  }

  return null;
}

async function convertDocumentWithLibreOffice(filePath, target, output) {
  const sofficePath = await libreOfficeBinaryPath();

  if (!sofficePath) {
    throw new Error("LibreOffice was not found. Install LibreOffice or choose Microsoft Office in Settings.");
  }

  const outputDir = outputDirectoryFor(filePath, output);
  const outputPath = await uniquePath(path.join(outputDir, `${outputBaseNameFor(filePath, output)}.${target}`));
  const tempDir = await fs.mkdtemp(path.join(outputDir, ".powerful-converter-"));

  try {
    await execFileAsync(
      sofficePath,
      ["--headless", "--convert-to", target, "--outdir", tempDir, filePath],
      { windowsHide: true, timeout: 180000 }
    );

    const expectedPath = path.join(tempDir, `${baseNameWithoutExtension(filePath)}.${target}`);
    const generatedPath = (await pathExists(expectedPath))
      ? expectedPath
      : path.join(
        tempDir,
        (await fs.readdir(tempDir)).find((entry) => entry.toLowerCase().endsWith(`.${target}`)) || ""
      );

    if (!(await pathExists(generatedPath))) {
      throw new Error(`LibreOffice finished but no ${target.toUpperCase()} file was created.`);
    }

    await fs.rename(generatedPath, outputPath);
  } catch (error) {
    throw new Error(`LibreOffice ${target.toUpperCase()} conversion failed. ${error.stderr || error.message}`);
  } finally {
    await fs.rmdir(tempDir).catch(() => {});
  }

  return [outputPath];
}

async function convertDocumentToPdfWithLibreOffice(filePath, output) {
  return convertDocumentWithLibreOffice(filePath, "pdf", output);
}

async function convertDocumentWithOffice(filePath, target, output) {
  const mode = documentConversionMode(filePath, target);

  if (!mode) {
    throw new Error(`Cannot convert this document to ${target.toUpperCase()}.`);
  }

  const outputDir = outputDirectoryFor(filePath, output);
  const outputPath = await uniquePath(path.join(outputDir, `${outputBaseNameFor(filePath, output)}.${target}`));
  const tempScript = await uniquePath(path.join(outputDir, `${baseNameWithoutExtension(outputPath)}_office_convert.ps1`));

  await fs.writeFile(tempScript, officePowerShellScript(filePath, outputPath, mode));

  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempScript],
      { windowsHide: true, timeout: 180000 }
    );
  } catch (error) {
    throw new Error(`Office document conversion failed. Make sure Microsoft Office is installed and the file is not password-protected. ${error.stderr || error.message}`);
  } finally {
    await fs.unlink(tempScript).catch(() => {});
  }

  if (!(await pathExists(outputPath))) {
    throw new Error("Document conversion finished but no output file was created.");
  }

  return [outputPath];
}

async function convertOfficeDocument(filePath, target, output, engine = "office") {
  const selectedEngine = cleanDocumentPdfEngine(engine);
  const mode = documentConversionMode(filePath, target);

  if (!mode) {
    throw new Error(`Cannot convert this document to ${target.toUpperCase()}.`);
  }

  if (!isSupportedDocumentTarget(filePath, target)) {
    throw new Error(`Cannot convert this document to ${target.toUpperCase()}.`);
  }

  if (target !== "pdf" && selectedEngine === "libreoffice") {
    return convertDocumentWithLibreOffice(filePath, target, output);
  }

  if (target !== "pdf" && selectedEngine === "auto") {
    try {
      return await convertDocumentWithOffice(filePath, target, output);
    } catch (officeError) {
      try {
        return await convertDocumentWithLibreOffice(filePath, target, output);
      } catch (libreOfficeError) {
        throw new Error(`Document conversion failed locally. Microsoft Office: ${officeError.message} LibreOffice: ${libreOfficeError.message}`);
      }
    }
  }

  if (target !== "pdf") {
    return convertDocumentWithOffice(filePath, target, output);
  }

  if (selectedEngine === "libreoffice") {
    return convertDocumentToPdfWithLibreOffice(filePath, output);
  }

  if (selectedEngine === "auto") {
    try {
      return await convertDocumentWithOffice(filePath, target, output);
    } catch (officeError) {
      try {
        return await convertDocumentToPdfWithLibreOffice(filePath, output);
      } catch (libreOfficeError) {
        throw new Error(`Office PDF conversion failed locally. Microsoft Office: ${officeError.message} LibreOffice: ${libreOfficeError.message}`);
      }
    }
  }

  return convertDocumentWithOffice(filePath, target, output);
}

async function convertDocumentToImageFormat(filePath, target, request, options = {}) {
  const outputDir = outputDirectoryFor(filePath, request.output);
  const tempDir = await fs.mkdtemp(path.join(outputDir, ".powerful-converter-"));
  let tempPdfPath = null;

  try {
    const [createdPdfPath] = await convertOfficeDocument(
      filePath,
      "pdf",
      { mode: "custom", directory: tempDir },
      request.documentPdfEngine
    );

    tempPdfPath = createdPdfPath;
    return await convertPdfToImageFormat(
      tempPdfPath,
      target,
      Number(request.pdfDpi || 150),
      request.output,
      options
    );
  } finally {
    if (tempPdfPath) {
      await fs.unlink(tempPdfPath).catch(() => {});
    }

    await fs.rmdir(tempDir).catch(() => {});
  }
}

async function embedImagePage(pdfDoc, filePath, dpi) {
  const extension = path.extname(filePath).toLowerCase();
  const isJpeg = [".jpg", ".jpeg"].includes(extension);
  const bytes = isJpeg
    ? await fs.readFile(filePath)
    : await (await imageSharp(filePath)).rotate().png().toBuffer();
  const embedded = isJpeg
    ? await pdfDoc.embedJpg(bytes)
    : await pdfDoc.embedPng(bytes);
  const width = (embedded.width / dpi) * 72;
  const height = (embedded.height / dpi) * 72;
  const page = pdfDoc.addPage([width, height]);

  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width,
    height
  });
}

async function convertImageToPdf(filePath, output, dpi) {
  const outputDir = outputDirectoryFor(filePath, output);
  const outputPath = await uniquePath(path.join(outputDir, `${outputBaseNameFor(filePath, output)}.pdf`));
  const pdfDoc = await PDFDocument.create();

  await embedImagePage(pdfDoc, filePath, dpi);
  await fs.writeFile(outputPath, await pdfDoc.save());

  return [outputPath];
}

async function convertImagesToSinglePdf(items, output, dpi) {
  if (items.length === 0) {
    return null;
  }

  const firstPath = items[0].path;
  const outputDir = outputDirectoryFor(firstPath, output);
  const outputPath = await uniquePath(path.join(outputDir, `${outputBaseNameFor(firstPath, output)}_combined.pdf`));
  const pdfDoc = await PDFDocument.create();

  for (const item of items) {
    await embedImagePage(pdfDoc, item.path, dpi);
  }

  await fs.writeFile(outputPath, await pdfDoc.save());
  return outputPath;
}

async function convertPdfToPng(filePath, dpi, output) {
  const outputDir = outputDirectoryFor(filePath, output);
  const baseName = outputBaseNameFor(filePath, output);
  const tempPrefix = `${baseName}_page_tmp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const tempRoot = path.join(outputDir, tempPrefix);
  const poppler = new Poppler(popplerBinaryPath());

  await poppler.pdfToCairo(filePath, tempRoot, {
    pngFile: true,
    resolutionXAxis: dpi,
    resolutionYAxis: dpi
  });

  const entries = await fs.readdir(outputDir);
  const generated = entries
    .filter((entry) => entry.startsWith(tempPrefix) && entry.toLowerCase().endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (generated.length === 0) {
    throw new Error("PDF conversion finished but no PNG pages were created.");
  }

  const outputPaths = [];

  for (let index = 0; index < generated.length; index += 1) {
    const sourcePath = path.join(outputDir, generated[index]);
    const pageNumber = String(index + 1).padStart(3, "0");
    const finalPath = await uniquePath(path.join(outputDir, `${baseName}_page-${pageNumber}.png`));

    await fs.rename(sourcePath, finalPath);
    outputPaths.push(finalPath);
  }

  return outputPaths;
}

async function convertPdfToImageFormat(filePath, target, dpi, output, options = {}) {
  const pngPaths = await convertPdfToPng(filePath, dpi, output);

  if (target === "png") {
    return pngPaths;
  }

  const outputPaths = [];

  for (const pngPath of pngPaths) {
    outputPaths.push(...await convertImageFormat(pngPath, target, { ...output, fileNameFormat: null }, options));
    await fs.unlink(pngPath);
  }

  return outputPaths;
}

function markdownHeadingText(value) {
  return String(value || "PDF document")
    .replace(/[_-]+/g, " ")
    .replace(/[#*`[\]<>]/g, "")
    .replace(/\s+/g, " ")
    .trim() || "PDF document";
}

function normalizePdfPageTextForMarkdown(pageText) {
  return String(pageText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pdfTextToMarkdown(text, filePath) {
  const title = markdownHeadingText(baseNameWithoutExtension(filePath));
  const pages = String(text || "")
    .replace(/\u0000/g, "")
    .split("\f")
    .map(normalizePdfPageTextForMarkdown)
    .filter(Boolean);

  if (pages.length === 0) {
    return `# ${title}\n\n_No extractable text found in this PDF._\n`;
  }

  const body = pages.length === 1
    ? pages[0]
    : pages.map((pageText, index) => `## Page ${index + 1}\n\n${pageText}`).join("\n\n");

  return `# ${title}\n\n${body}\n`;
}

async function convertPdfToMarkdown(filePath, output) {
  const outputDir = outputDirectoryFor(filePath, output);
  const outputPath = await uniquePath(path.join(outputDir, `${outputBaseNameFor(filePath, output)}.md`));
  const poppler = new Poppler(popplerBinaryPath());

  let text = "";

  try {
    text = await poppler.pdfToText(filePath, undefined, {
      outputEncoding: "UTF-8"
    });
  } catch (error) {
    throw new Error(`PDF to Markdown conversion failed. ${error.stderr || error.message}`);
  }

  await fs.writeFile(outputPath, pdfTextToMarkdown(text, filePath), "utf8");
  return [outputPath];
}

async function ensureOutputDirectory(output) {
  if (output?.mode === "custom") {
    if (!output.directory) {
      throw new Error("Choose an output folder before converting.");
    }

    if (!fssync.existsSync(output.directory)) {
      await fs.mkdir(output.directory, { recursive: true });
    }
  }
}

async function convertSingle(item, request, onProgress = () => {}) {
  const kind = getKind(item.path);
  const target = cleanTarget(item.target);
  const itemOptions = item.options || {};

  if (kind === "unsupported") {
    throw new Error("Unsupported file type.");
  }

  if (!isSupportedTarget(kind, target)) {
    throw new Error(`Cannot convert this file to ${target.toUpperCase()}.`);
  }

  if (!(await pathExists(item.path))) {
    throw new Error("Source file does not exist.");
  }

  if (kind === "image" && target === "pdf") {
    return convertImageToPdf(item.path, request.output, imagePdfDpiFromRequest(request));
  }

  if (kind === "image") {
    return convertImageFormat(item.path, target, request.output, itemOptions);
  }

  if (kind === "document") {
    if (OUTPUT_TARGETS.has(target)) {
      return convertDocumentToImageFormat(item.path, target, request, itemOptions);
    }

    if (!isSupportedDocumentTarget(item.path, target)) {
      throw new Error(`Cannot convert this document to ${target.toUpperCase()}.`);
    }

    return convertOfficeDocument(item.path, target, request.output, request.documentPdfEngine);
  }

  if (kind === "video" || kind === "audio") {
    return convertMediaFormat(
      item.path,
      target,
      request.output,
      kind,
      request.mediaEncodingMode,
      itemOptions,
      (progress) => {
        onProgress({ id: item.id, ...progress });
      }
    );
  }

  if (kind === "pdf" && target === "md") {
    return convertPdfToMarkdown(item.path, request.output);
  }

  return convertPdfToImageFormat(item.path, target, Number(request.pdfDpi || 150), request.output, itemOptions);
}

async function convertBatch(request, onProgress = () => {}) {
  await ensureOutputDirectory(request.output);

  const files = Array.isArray(request.files) ? request.files : [];
  const results = [];
  const combineItems = [];

  for (const item of files) {
    const kind = getKind(item.path);
    const target = cleanTarget(item.target);

    if (kind === "image" && target === "pdf" && request.imageToPdfMode === "combine") {
      combineItems.push({ ...item, target });
      continue;
    }

    onProgress({ id: item.id, status: "running", message: "Converting..." });

    try {
      const outputPaths = await convertSingle({ ...item, target }, request, onProgress);
      const result = { id: item.id, status: "done", outputPaths };

      results.push(result);
      onProgress({ ...result, message: "Done" });
    } catch (error) {
      const result = { id: item.id, status: "error", error: shortErrorMessage(error) };

      results.push(result);
      onProgress({ ...result, message: result.error });
    }
  }

  if (combineItems.length > 0) {
    for (const item of combineItems) {
      onProgress({ id: item.id, status: "running", message: "Adding to combined PDF..." });
    }

    try {
      const outputPath = await convertImagesToSinglePdf(
        combineItems,
        request.output,
        imagePdfDpiFromRequest(request)
      );

      for (const item of combineItems) {
        const result = { id: item.id, status: "done", outputPaths: [outputPath] };

        results.push(result);
        onProgress({ ...result, message: "Added to combined PDF" });
      }
    } catch (error) {
      for (const item of combineItems) {
        const result = { id: item.id, status: "error", error: shortErrorMessage(error) };

        results.push(result);
        onProgress({ ...result, message: result.error });
      }
    }
  }

  return results;
}

module.exports = {
  convertBatch,
  convertImageFormat,
  convertImageToPdf,
  convertImagesToSinglePdf,
  convertMediaFormat,
  convertOfficeDocument,
  convertPdfToImageFormat,
  convertPdfToPng,
  getKind,
  uniquePath
};
