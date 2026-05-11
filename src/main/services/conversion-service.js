const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
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
const WORD_TARGETS = new Set(["pdf", "doc", "docx", "rtf", "txt", "odt"]);
const PRESENTATION_TARGETS = new Set(["pdf", "ppt", "pptx"]);
const SPREADSHEET_TARGETS = new Set(["pdf", "xls", "xlsx"]);
const DOCUMENT_TARGETS = new Set([...WORD_TARGETS, ...PRESENTATION_TARGETS, ...SPREADSHEET_TARGETS]);
const OUTPUT_TARGETS = new Set(["png", "jpg", "gif", "tiff", "tif", "bmp", "webp", "ico", "avif", "jp2", "jxl", "svg", "emf"]);
const DOCUMENT_PDF_ENGINES = new Set(["office", "libreoffice", "auto"]);
let jxlEncoderPromise = null;
let openJpegPromise = null;

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
    return OUTPUT_TARGETS.has(target);
  }

  if (kind === "document") {
    return OUTPUT_TARGETS.has(target) || isSupportedDocumentTarget("", target);
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

async function convertImageFormat(filePath, target, output) {
  const outputDir = outputDirectoryFor(filePath, output);
  const baseName = outputBaseNameFor(filePath, output);
  const outputPath = await uniquePath(path.join(outputDir, `${baseName}.${outputExtensionFor(target)}`));
  const image = (await imageSharp(filePath)).rotate();

  if (target === "png") {
    await image.png({ compressionLevel: 9 }).toFile(outputPath);
    return [outputPath];
  }

  if (target === "jpg") {
    await image.flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toFile(outputPath);
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
    await image.webp({ quality: 92 }).toFile(outputPath);
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
    { quality: 90 }
  );

  await fs.writeFile(outputPath, Buffer.from(encoded));
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

async function convertDocumentToImageFormat(filePath, target, request) {
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
      request.output
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

async function convertPdfToImageFormat(filePath, target, dpi, output) {
  const pngPaths = await convertPdfToPng(filePath, dpi, output);

  if (target === "png") {
    return pngPaths;
  }

  const outputPaths = [];

  for (const pngPath of pngPaths) {
    outputPaths.push(...await convertImageFormat(pngPath, target, { ...output, fileNameFormat: null }));
    await fs.unlink(pngPath);
  }

  return outputPaths;
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

async function convertSingle(item, request) {
  const kind = getKind(item.path);
  const target = cleanTarget(item.target);

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
    return convertImageFormat(item.path, target, request.output);
  }

  if (kind === "document") {
    if (OUTPUT_TARGETS.has(target)) {
      return convertDocumentToImageFormat(item.path, target, request);
    }

    if (!isSupportedDocumentTarget(item.path, target)) {
      throw new Error(`Cannot convert this document to ${target.toUpperCase()}.`);
    }

    return convertOfficeDocument(item.path, target, request.output, request.documentPdfEngine);
  }

  return convertPdfToImageFormat(item.path, target, Number(request.pdfDpi || 150), request.output);
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
      const outputPaths = await convertSingle({ ...item, target }, request);
      const result = { id: item.id, status: "done", outputPaths };

      results.push(result);
      onProgress({ ...result, message: "Done" });
    } catch (error) {
      const result = { id: item.id, status: "error", error: error.message };

      results.push(result);
      onProgress({ ...result, message: error.message });
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
        const result = { id: item.id, status: "error", error: error.message };

        results.push(result);
        onProgress({ ...result, message: error.message });
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
  convertOfficeDocument,
  convertPdfToImageFormat,
  convertPdfToPng,
  getKind,
  uniquePath
};
