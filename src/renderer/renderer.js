const addFilesButton = document.querySelector("#addFilesButton");
const clearButton = document.querySelector("#clearButton");
const settingsButton = document.querySelector("#settingsButton");
const closeSettingsButton = document.querySelector("#closeSettingsButton");
const settingsPanel = document.querySelector("#settingsPanel");
const documentPdfEngine = document.querySelector("#documentPdfEngine");
const fileNameUsePrefix = document.querySelector("#fileNameUsePrefix");
const fileNamePrefix = document.querySelector("#fileNamePrefix");
const fileNameUseOriginal = document.querySelector("#fileNameUseOriginal");
const fileNameUseSuffix = document.querySelector("#fileNameUseSuffix");
const fileNameSuffix = document.querySelector("#fileNameSuffix");
const fileNameUseConverted = document.querySelector("#fileNameUseConverted");
const fileNamePreview = document.querySelector("#fileNamePreview");
const chooseFolderButton = document.querySelector("#chooseFolderButton");
const selectedFolder = document.querySelector("#selectedFolder");
const convertFilesButton = document.querySelector("#convertFilesButton");
const convertImagePdfButton = document.querySelector("#convertImagePdfButton");
const filesDropZone = document.querySelector("#filesDropZone");
const imagePdfDropZone = document.querySelector("#imagePdfDropZone");
const fileTableBody = document.querySelector("#fileTableBody");
const imagePdfGrid = document.querySelector("#imagePdfGrid");
const selectAllFiles = document.querySelector("#selectAllFiles");
const bulkFileTarget = document.querySelector("#bulkFileTarget");
const applyFileTargetButton = document.querySelector("#applyFileTargetButton");
const removeSelectedFilesButton = document.querySelector("#removeSelectedFilesButton");
const selectAllImages = document.querySelector("#selectAllImages");
const bulkImageTarget = document.querySelector("#bulkImageTarget");
const applyImageTargetButton = document.querySelector("#applyImageTargetButton");
const removeSelectedImagesButton = document.querySelector("#removeSelectedImagesButton");
const pdfDpi = document.querySelector("#pdfDpi");
const imagePdfDpi = document.querySelector("#imagePdfDpi");
const imagePdfDpiNumber = document.querySelector("#imagePdfDpiNumber");
const toastHost = document.querySelector("#toastHost");
const pageButtons = document.querySelectorAll(".tab-button");
const pages = document.querySelectorAll(".page");

if (!window.converter) {
  window.converter = {
    selectFiles: async () => [],
    selectOutputFolder: async () => null,
    convert: async () => [],
    showMessage: async (options) => window.alert(`${options.message}\n\n${options.detail || ""}`),
    getPathForFile: (file) => file.name,
    onConversionProgress: () => () => {}
  };
}

let activePage = "files";
let fileQueue = [];
let imagePdfQueue = [];
let outputDirectory = null;
let nextId = 1;
let draggedImageId = null;
let activeBulkFileTarget = "png";
let activeFormatPicker = null;
let toastTimer = null;
const settingsStorageKey = "powerfulConverter.settings";

const extensionKinds = new Map([
  [".jpg", "image"],
  [".jpeg", "image"],
  [".png", "image"],
  [".gif", "image"],
  [".tiff", "image"],
  [".tif", "image"],
  [".bmp", "image"],
  [".webp", "image"],
  [".ico", "image"],
  [".avif", "image"],
  [".jp2", "image"],
  [".j2k", "image"],
  [".j2c", "image"],
  [".jpx", "image"],
  [".jxl", "image"],
  [".svg", "image"],
  [".svgz", "image"],
  [".emf", "image"],
  [".raw", "image"],
  [".dng", "image"],
  [".proraw", "image"],
  [".cr2", "image"],
  [".cr3", "image"],
  [".nef", "image"],
  [".nrw", "image"],
  [".arw", "image"],
  [".sr2", "image"],
  [".srf", "image"],
  [".rwl", "image"],
  [".heic", "image"],
  [".heif", "image"],
  [".doc", "document"],
  [".docx", "document"],
  [".odt", "document"],
  [".ppt", "document"],
  [".pptx", "document"],
  [".rtf", "document"],
  [".txt", "document"],
  [".xls", "document"],
  [".xlsx", "document"],
  [".pdf", "pdf"]
]);

const outputFormats = [
  { value: "gif", label: "GIF", keywords: "gif" },
  { value: "tiff", label: "TIFF", keywords: "tiff tif" },
  { value: "tif", label: "TIF", keywords: "tif tiff" },
  { value: "bmp", label: "BMP", keywords: "bmp bitmap" },
  { value: "webp", label: "WebP", keywords: "webp" },
  { value: "ico", label: "ICO", keywords: "ico icon" },
  { value: "avif", label: "AVIF", keywords: "avif" },
  { value: "jpg", label: "JPG", keywords: "jpg jpeg" },
  { value: "jp2", label: "JPEG 2000", keywords: "jpeg 2000 jp2 j2k jpx" },
  { value: "jxl", label: "JPEG XL", keywords: "jpeg xl jxl" },
  { value: "svg", label: "SVG", keywords: "svg vector" },
  { value: "emf", label: "EMF", keywords: "emf" },
  { value: "png", label: "PNG", keywords: "png" }
];

const outputFormatLabels = new Map(outputFormats.map((format) => [format.value, format.label]));
const documentFormats = [
  { value: "pdf", label: "PDF", keywords: "pdf document" },
  { value: "doc", label: "DOC", keywords: "doc word document" },
  { value: "docx", label: "DOCX", keywords: "docx word document" },
  { value: "rtf", label: "RTF", keywords: "rtf rich text document" },
  { value: "txt", label: "TXT", keywords: "txt text document" },
  { value: "odt", label: "ODT", keywords: "odt open document text" },
  { value: "ppt", label: "PPT", keywords: "ppt powerpoint presentation" },
  { value: "pptx", label: "PPTX", keywords: "pptx powerpoint presentation" },
  { value: "xls", label: "XLS", keywords: "xls excel spreadsheet" },
  { value: "xlsx", label: "XLSX", keywords: "xlsx excel spreadsheet" }
];
const documentFormatLabels = new Map(documentFormats.map((format) => [format.value, format.label]));
const wordTargets = new Set(["pdf", "doc", "docx", "rtf", "txt", "odt"]);
const presentationTargets = new Set(["pdf", "ppt", "pptx"]);
const spreadsheetTargets = new Set(["pdf", "xls", "xlsx"]);
const allFileOutputFormats = [...documentFormats, ...outputFormats];
const formatGroups = [
  { value: "image", label: "Image" },
  { value: "document", label: "Document" }
];

function extensionOf(filePath) {
  const match = filePath.toLowerCase().match(/\.[^.\\\/]+$/);
  return match ? match[0] : "";
}

function basename(filePath) {
  return filePath.split(/[\\\/]/).pop() || filePath;
}

function dirname(filePath) {
  const index = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  return index > -1 ? filePath.slice(0, index) : "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fileUrl(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const encoded = prefixed
    .split("/")
    .map((part, index) => (index === 1 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join("/");

  return `file://${encoded}`;
}

function detectKind(filePath) {
  return extensionKinds.get(extensionOf(filePath)) || "unsupported";
}

function selectedRadio(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

function selectedDocumentPdfEngine() {
  return documentPdfEngine?.value || "office";
}

function selectedFileNameFormat() {
  return {
    usePrefix: Boolean(fileNameUsePrefix?.checked),
    prefix: fileNamePrefix?.value || "",
    useOriginal: fileNameUseOriginal?.checked !== false,
    useSuffix: Boolean(fileNameUseSuffix?.checked),
    suffix: fileNameSuffix?.value || "",
    useConvertedText: Boolean(fileNameUseConverted?.checked)
  };
}

function updateFileNameControls() {
  if (fileNamePrefix) {
    fileNamePrefix.disabled = !fileNameUsePrefix?.checked;
  }

  if (fileNameSuffix) {
    fileNameSuffix.disabled = !fileNameUseSuffix?.checked;
  }

  const format = selectedFileNameFormat();
  const parts = [];

  if (format.usePrefix && format.prefix) {
    parts.push(format.prefix);
  }

  if (format.useOriginal) {
    parts.push("OriginalName");
  }

  if (format.useSuffix && format.suffix) {
    parts.push(format.suffix);
  }

  if (format.useConvertedText) {
    parts.push("Converted_File");
  }

  if (fileNamePreview) {
    fileNamePreview.textContent = parts.join("") || "OriginalName";
  }
}

function loadSettings() {
  let saved = null;
  let raw = null;

  try {
    raw = window.localStorage?.getItem(settingsStorageKey);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = raw ? { documentPdfEngine: raw } : null;
  }

  if (typeof saved === "string") {
    saved = { documentPdfEngine: saved };
  }

  if (documentPdfEngine && ["office", "libreoffice", "auto"].includes(saved?.documentPdfEngine)) {
    documentPdfEngine.value = saved.documentPdfEngine;
  }

  const fileNameFormat = saved?.fileNameFormat || {};

  if (fileNameUsePrefix) {
    fileNameUsePrefix.checked = Boolean(fileNameFormat.usePrefix);
  }

  if (fileNamePrefix) {
    fileNamePrefix.value = fileNameFormat.prefix || "";
  }

  if (fileNameUseOriginal) {
    fileNameUseOriginal.checked = fileNameFormat.useOriginal !== false;
  }

  if (fileNameUseSuffix) {
    fileNameUseSuffix.checked = Boolean(fileNameFormat.useSuffix);
  }

  if (fileNameSuffix) {
    fileNameSuffix.value = fileNameFormat.suffix || "";
  }

  if (fileNameUseConverted) {
    fileNameUseConverted.checked = Boolean(fileNameFormat.useConvertedText);
  }

  updateFileNameControls();
}

function saveSettings() {
  try {
    window.localStorage?.setItem(settingsStorageKey, JSON.stringify({
      documentPdfEngine: selectedDocumentPdfEngine(),
      fileNameFormat: selectedFileNameFormat()
    }));
  } catch {
    // Storage can be unavailable in some packaged/local Electron contexts.
  }
}

function defaultFileTarget(filePath) {
  const kind = detectKind(filePath);
  const extension = extensionOf(filePath);

  if (kind === "pdf") {
    return "png";
  }

  if (kind === "image") {
    return extension === ".png" ? "jpg" : "png";
  }

  if (kind === "document") {
    return "pdf";
  }

  return "";
}

function fileTargetOptions(file) {
  if (file.kind === "image") {
    return outputFormats;
  }

  if (file.kind === "pdf") {
    return outputFormats;
  }

  if (file.kind === "document") {
    const extension = extensionOf(file.path);

    if ([".doc", ".docx", ".rtf", ".txt", ".odt"].includes(extension)) {
      return [
        ...documentFormats.filter((format) => wordTargets.has(format.value)),
        ...outputFormats
      ];
    }

    if ([".ppt", ".pptx"].includes(extension)) {
      return [
        ...documentFormats.filter((format) => presentationTargets.has(format.value)),
        ...outputFormats
      ];
    }

    if ([".xls", ".xlsx"].includes(extension)) {
      return [
        ...documentFormats.filter((format) => spreadsheetTargets.has(format.value)),
        ...outputFormats
      ];
    }
  }

  return [];
}

function formatLabel(value) {
  return outputFormatLabels.get(value) || documentFormatLabels.get(value) || String(value).toUpperCase();
}

function pickerKey(type, id = "bulk") {
  return `${type}:${id}`;
}

function parsePickerKey(key) {
  const [type, id] = String(key || "").split(":");
  return { type, id };
}

function updatePageScrollSpace() {
  document.body.classList.toggle("format-menu-open", Boolean(activeFormatPicker));
}

function filteredFormats(query, formats) {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return formats;
  }

  return formats.filter((format) => `${format.label} ${format.value} ${format.keywords}`.toLowerCase().includes(needle));
}

function formatGroupFor(value) {
  return documentFormatLabels.has(value) ? "document" : "image";
}

function formatGroupsFor(formats) {
  const available = new Set(formats.map((format) => formatGroupFor(format.value)));
  return formatGroups.filter((group) => available.has(group.value));
}

function selectedFormatGroup(value, formats, requestedGroup) {
  const available = formatGroupsFor(formats);

  if (available.some((group) => group.value === requestedGroup)) {
    return requestedGroup;
  }

  const valueGroup = formatGroupFor(value);
  if (available.some((group) => group.value === valueGroup)) {
    return valueGroup;
  }

  return available[0]?.value || "image";
}

function renderFormatPicker({ type, id = "bulk", value, formats, label }) {
  const key = pickerKey(type, id);
  const isOpen = activeFormatPicker?.key === key;
  const query = isOpen ? activeFormatPicker.query : "";
  const activeGroup = isOpen ? selectedFormatGroup(value, formats, activeFormatPicker.group) : selectedFormatGroup(value, formats);
  const visibleFormats = formats.filter((format) => formatGroupFor(format.value) === activeGroup);
  const matches = filteredFormats(query, visibleFormats);
  const groups = formatGroupsFor(formats);
  const typeOptions = groups.map((group) => `
    <button class="format-type-button ${group.value === activeGroup ? "is-active" : ""}" type="button" data-action="choose-format-group" data-picker-type="${type}" data-id="${id}" data-group="${group.value}">
      ${escapeHtml(group.label)}
    </button>
  `).join("");
  const options = matches.length > 0
    ? matches.map((format) => `
      <button class="format-option ${format.value === value ? "is-selected" : ""}" type="button" data-action="choose-format" data-picker-type="${type}" data-id="${id}" data-value="${format.value}">
        ${escapeHtml(format.label)}
      </button>
    `).join("")
    : '<div class="format-empty">No formats found</div>';

  return `
    <div class="format-picker-control">
      <button class="format-trigger" type="button" data-action="toggle-format-picker" data-picker-type="${type}" data-id="${id}" aria-label="${escapeHtml(label)}">
        <span>${escapeHtml(formatLabel(value))}</span>
        <span class="format-chevron">v</span>
      </button>
      ${isOpen ? `
        <div class="format-panel">
          <div class="format-panel-layout">
            <aside class="format-type-list" aria-label="Format type">
              ${typeOptions}
            </aside>
            <div class="format-list-pane">
              <input class="format-search" type="search" value="${escapeHtml(query)}" data-action="search-format" data-picker-type="${type}" data-id="${id}" placeholder="Search format" aria-label="Search format">
              <div class="format-grid">${options}</div>
            </div>
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function renderBulkFileTarget() {
  bulkFileTarget.innerHTML = renderFormatPicker({
    type: "bulk",
    value: activeBulkFileTarget,
    formats: allFileOutputFormats,
    label: "Bulk output format"
  });
}

function makeFileItem(filePath) {
  const kind = detectKind(filePath);

  return {
    id: nextId++,
    path: filePath,
    name: basename(filePath),
    folder: dirname(filePath),
    kind,
    target: defaultFileTarget(filePath),
    status: kind === "unsupported" ? "unsupported" : "ready",
    message: kind === "unsupported" ? "Unsupported" : "Ready",
    outputPaths: [],
    selected: false,
    thumbnail: kind === "image" ? fileUrl(filePath) : ""
  };
}

function makeImagePdfItem(filePath) {
  const kind = detectKind(filePath);
  const supported = kind === "image";

  return {
    id: nextId++,
    path: filePath,
    name: basename(filePath),
    folder: dirname(filePath),
    kind,
    target: "pdf",
    status: supported ? "ready" : "unsupported",
    message: supported ? "Ready" : "Images only",
    outputPaths: [],
    selected: false,
    thumbnail: supported ? fileUrl(filePath) : ""
  };
}

function addFilePaths(paths) {
  const existing = new Set(fileQueue.map((file) => file.path.toLowerCase()));
  const additions = paths
    .filter(Boolean)
    .filter((filePath) => !existing.has(filePath.toLowerCase()))
    .map(makeFileItem);

  fileQueue = [...fileQueue, ...additions];
  renderFiles();
}

function addImagePdfPaths(paths) {
  const existing = new Set(imagePdfQueue.map((file) => file.path.toLowerCase()));
  const additions = paths
    .filter(Boolean)
    .filter((filePath) => !existing.has(filePath.toLowerCase()))
    .map(makeImagePdfItem);

  imagePdfQueue = [...imagePdfQueue, ...additions];
  renderImagePdf();
}

function activeQueueHasFiles() {
  return activePage === "files" ? fileQueue.length > 0 : imagePdfQueue.length > 0;
}

function selectedCount(queue) {
  return queue.filter((file) => file.selected).length;
}

function selectableCount(queue, kind = null) {
  return queue.filter((file) => !kind || file.kind === kind).length;
}

function selectedSupportedCount(queue, kind = null) {
  return queue.filter((file) => file.selected && (!kind || file.kind === kind)).length;
}

function updateBulkControls() {
  const fileSelected = selectedCount(fileQueue);
  const fileSelectable = selectableCount(fileQueue);
  selectAllFiles.checked = fileSelectable > 0 && fileSelected === fileSelectable;
  selectAllFiles.indeterminate = fileSelected > 0 && fileSelected < fileSelectable;
  selectAllFiles.disabled = fileSelectable === 0;
  applyFileTargetButton.disabled = selectedSupportedCount(fileQueue) === 0;
  removeSelectedFilesButton.disabled = fileSelected === 0;

  const imageSelected = selectedCount(imagePdfQueue);
  const imageSelectable = selectableCount(imagePdfQueue);
  selectAllImages.checked = imageSelectable > 0 && imageSelected === imageSelectable;
  selectAllImages.indeterminate = imageSelected > 0 && imageSelected < imageSelectable;
  selectAllImages.disabled = imageSelectable === 0;
  bulkImageTarget.disabled = true;
  applyImageTargetButton.disabled = selectedSupportedCount(imagePdfQueue, "image") === 0;
  removeSelectedImagesButton.disabled = imageSelected === 0;
}

function updateAddButton() {
  addFilesButton.innerHTML = `<span class="button-icon">+</span>${activePage === "files" ? "Add files" : "Add images"}`;
  clearButton.disabled = !activeQueueHasFiles();
  updateBulkControls();
}

function setActivePage(page) {
  activePage = page;

  pageButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === page);
  });

  pages.forEach((section) => {
    section.classList.toggle("is-active", section.id === `${page}Page`);
  });

  updateAddButton();
}

function outputRequest() {
  const outputMode = selectedRadio("outputMode");

  if (outputMode === "custom" && !outputDirectory) {
    selectedFolder.textContent = "Choose a folder first";
    return null;
  }

  return {
    mode: outputMode,
    directory: outputMode === "custom" ? outputDirectory : null,
    fileNameFormat: selectedFileNameFormat()
  };
}

function clampDpi(value) {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return 150;
  }

  return Math.min(300, Math.max(96, Math.round(parsed)));
}

function syncImagePdfDpi(sourceValue) {
  const dpi = clampDpi(sourceValue);
  imagePdfDpi.value = String(dpi);
  imagePdfDpiNumber.value = String(dpi);
}

function setFileStatus(id, status, message, outputPaths = []) {
  fileQueue = fileQueue.map((file) => {
    if (file.id !== id) {
      return file;
    }

    return { ...file, status, message, outputPaths };
  });

  imagePdfQueue = imagePdfQueue.map((file) => {
    if (file.id !== id) {
      return file;
    }

    return { ...file, status, message, outputPaths };
  });

  renderFiles();
  renderImagePdf();
}

function removeFileQueueItem(id) {
  fileQueue = fileQueue.filter((file) => file.id !== id);
  renderFiles();
}

function removeImagePdfItem(id) {
  imagePdfQueue = imagePdfQueue.filter((file) => file.id !== id);
  renderImagePdf();
}

function setFileSelection(id, selected) {
  fileQueue = fileQueue.map((file) => (file.id === id ? { ...file, selected } : file));
  renderFiles();
}

function setImageSelection(id, selected) {
  imagePdfQueue = imagePdfQueue.map((file) => (file.id === id ? { ...file, selected } : file));
  renderImagePdf();
}

function selectAllFileQueue(selected) {
  fileQueue = fileQueue.map((file) => ({ ...file, selected }));
  renderFiles();
}

function selectAllImageQueue(selected) {
  imagePdfQueue = imagePdfQueue.map((file) => ({ ...file, selected }));
  renderImagePdf();
}

function removeSelectedFiles() {
  fileQueue = fileQueue.filter((file) => !file.selected);
  renderFiles();
}

function removeSelectedImages() {
  imagePdfQueue = imagePdfQueue.filter((file) => !file.selected);
  renderImagePdf();
}

function applySelectedFileTarget(target) {
  fileQueue = fileQueue.map((file) => {
    if (!file.selected || file.kind === "unsupported") {
      return file;
    }

    if (!fileTargetOptions(file).some((format) => format.value === target)) {
      return file;
    }

    return { ...file, target };
  });
  renderFiles();
}

function applySelectedImageTarget() {
  imagePdfQueue = imagePdfQueue.map((file) => (file.selected && file.kind === "image" ? { ...file, target: "pdf" } : file));
  renderImagePdf();
}

function reorderImagePdf(draggedId, targetId) {
  if (draggedId === null || draggedId === targetId) {
    return;
  }

  const fromIndex = imagePdfQueue.findIndex((file) => file.id === draggedId);
  const toIndex = imagePdfQueue.findIndex((file) => file.id === targetId);

  if (fromIndex < 0 || toIndex < 0) {
    return;
  }

  const next = [...imagePdfQueue];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  imagePdfQueue = next;
  renderImagePdf();
}

function updateFileTarget(id, target) {
  fileQueue = fileQueue.map((file) => (file.id === id ? { ...file, target } : file));
}

function renderFiles() {
  updatePageScrollSpace();
  convertFilesButton.disabled = fileQueue.length === 0 || fileQueue.every((file) => file.kind === "unsupported");
  renderBulkFileTarget();

  if (fileQueue.length === 0) {
    fileTableBody.innerHTML = '<tr class="empty-row"><td colspan="6">No files added yet.</td></tr>';
    updateAddButton();
    return;
  }

  fileTableBody.innerHTML = fileQueue.map((file) => {
    const statusClass = `status ${file.status}`;
    const outputTitle = file.outputPaths.length > 0 ? ` title="${escapeHtml(file.outputPaths.join("\n"))}"` : "";
    const targetControl = file.kind === "unsupported"
      ? '<span class="status unsupported">Not available</span>'
      : renderFormatPicker({
        type: "row",
        id: String(file.id),
        value: file.target,
        formats: fileTargetOptions(file),
        label: `Output format for ${file.name}`
      });
    const preview = file.thumbnail
      ? `<img class="file-preview" src="${escapeHtml(file.thumbnail)}" alt="">`
      : `<div class="file-preview placeholder">${escapeHtml(file.kind === "pdf" ? "PDF" : "FILE")}</div>`;

    return `
      <tr>
        <td>
          <input class="row-check" type="checkbox" data-action="select-file" data-id="${file.id}" ${file.selected ? "checked" : ""} aria-label="Select ${escapeHtml(file.name)}">
        </td>
        <td>
          <div class="file-cell">
            ${preview}
            <div>
              <div class="file-name">${escapeHtml(file.name)}</div>
              <span class="file-path">${escapeHtml(file.folder)}</span>
            </div>
          </div>
        </td>
        <td>${escapeHtml(file.kind.toUpperCase())}</td>
        <td>${targetControl}</td>
        <td><span class="${statusClass}"${outputTitle}>${escapeHtml(file.message)}</span></td>
        <td><button class="remove-button" type="button" data-action="remove" data-id="${file.id}">Remove</button></td>
      </tr>
    `;
  }).join("");

  updateAddButton();
}

function renderImagePdf() {
  updatePageScrollSpace();
  convertImagePdfButton.disabled = imagePdfQueue.length === 0 || imagePdfQueue.every((file) => file.kind !== "image");

  if (imagePdfQueue.length === 0) {
    imagePdfGrid.innerHTML = '<div class="empty-grid">No images added yet.</div>';
    updateAddButton();
    return;
  }

  imagePdfGrid.innerHTML = imagePdfQueue.map((file, index) => {
    const statusClass = `status ${file.status}`;
    const outputTitle = file.outputPaths.length > 0 ? ` title="${escapeHtml(file.outputPaths.join("\n"))}"` : "";
    const thumb = file.thumbnail
      ? `<img class="image-thumb" src="${escapeHtml(file.thumbnail)}" alt="">`
      : '<div class="image-thumb"></div>';

    return `
      <article class="image-card ${file.selected ? "is-selected" : ""}" draggable="${file.kind === "image"}" data-id="${file.id}">
        <div class="image-card-top">
          <input class="row-check" type="checkbox" data-action="select-image" data-id="${file.id}" ${file.selected ? "checked" : ""} aria-label="Select ${escapeHtml(file.name)}">
          <span class="drag-handle">${file.kind === "image" ? "Drag" : "Skip"}</span>
        </div>
        ${thumb}
        <div class="image-meta">
          <span class="image-card-name">${index + 1}. ${escapeHtml(file.name)}</span>
          <span class="image-card-path">${escapeHtml(file.folder)}</span>
        </div>
        <div class="image-card-footer">
          <span class="${statusClass}"${outputTitle}>${escapeHtml(file.message)}</span>
          <button class="remove-button" type="button" data-action="remove-image" data-id="${file.id}">Remove</button>
        </div>
      </article>
    `;
  }).join("");

  updateAddButton();
}

function installDropZone(dropZone, addCallback) {
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("is-over");
  });

  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-over");

    const paths = [...event.dataTransfer.files]
      .map((file) => window.converter.getPathForFile(file))
      .filter(Boolean);

    addCallback(paths);
  });
}

function hideToast() {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }

  toastHost.innerHTML = "";
}

function showToast({ type = "info", title, message, detail }) {
  hideToast();

  toastHost.innerHTML = `
    <section class="toast toast-${type}" role="status">
      <div class="toast-copy">
        <strong>${escapeHtml(title || "Powerful Converter")}</strong>
        <span>${escapeHtml(message || "")}</span>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
      </div>
      <button class="toast-close" type="button" aria-label="Close notification">x</button>
    </section>
  `;

  toastHost.querySelector(".toast-close")?.addEventListener("click", hideToast);
  toastTimer = window.setTimeout(hideToast, 3000);
}

function openSettings() {
  settingsPanel.hidden = false;
  settingsPanel.setAttribute("aria-hidden", "false");
  closeSettingsButton.focus();
}

function closeSettings() {
  settingsPanel.hidden = true;
  settingsPanel.setAttribute("aria-hidden", "true");
  settingsButton.focus();
}

function showConversionMessage(results, label) {
  const done = results.filter((result) => result.status === "done").length;
  const failed = results.filter((result) => result.status === "error").length;
  const outputCount = results.reduce((count, result) => count + (result.outputPaths?.length || 0), 0);

  if (failed === 0) {
    showToast({
      type: "info",
      title: "Conversion complete",
      message: `${label} finished successfully.`,
      detail: `${done} item(s) converted. ${outputCount} output file(s) created.`
    });
    return;
  }

  showToast({
    type: done > 0 ? "warning" : "error",
    title: "Conversion finished with errors",
    message: `${failed} item(s) could not be converted.`,
    detail: `${done} item(s) succeeded. Check the status column for details.`
  });
}

pageButtons.forEach((button) => {
  button.addEventListener("click", () => setActivePage(button.dataset.page));
});

addFilesButton.addEventListener("click", async () => {
  const paths = await window.converter.selectFiles();

  if (activePage === "files") {
    addFilePaths(paths);
  } else {
    addImagePdfPaths(paths);
  }
});

clearButton.addEventListener("click", () => {
  if (activePage === "files") {
    fileQueue = [];
    renderFiles();
  } else {
    imagePdfQueue = [];
    renderImagePdf();
  }
});

chooseFolderButton.addEventListener("click", async () => {
  const folder = await window.converter.selectOutputFolder();

  if (folder) {
    outputDirectory = folder;
    selectedFolder.textContent = folder;
    document.querySelector('input[name="outputMode"][value="custom"]').checked = true;
  }
});

settingsButton.addEventListener("click", openSettings);

closeSettingsButton.addEventListener("click", closeSettings);

settingsPanel.addEventListener("click", (event) => {
  if (event.target === settingsPanel) {
    closeSettings();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsPanel.hidden) {
    closeSettings();
  }
});

documentPdfEngine.addEventListener("change", saveSettings);

[
  fileNameUsePrefix,
  fileNamePrefix,
  fileNameUseOriginal,
  fileNameUseSuffix,
  fileNameSuffix,
  fileNameUseConverted
].forEach((control) => {
  control?.addEventListener("input", () => {
    updateFileNameControls();
    saveSettings();
  });
});

selectAllFiles.addEventListener("click", (event) => {
  event.stopPropagation();
  selectAllFileQueue(selectAllFiles.checked);
});
selectAllImages.addEventListener("click", (event) => {
  event.stopPropagation();
  selectAllImageQueue(selectAllImages.checked);
});
applyFileTargetButton.addEventListener("click", () => applySelectedFileTarget(activeBulkFileTarget));
applyImageTargetButton.addEventListener("click", applySelectedImageTarget);
removeSelectedFilesButton.addEventListener("click", removeSelectedFiles);
removeSelectedImagesButton.addEventListener("click", removeSelectedImages);

function handleFormatPickerClick(event) {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return false;
  }

  if (button.dataset.action === "toggle-format-picker") {
    event.stopPropagation();
    const key = pickerKey(button.dataset.pickerType, button.dataset.id);
    activeFormatPicker = activeFormatPicker?.key === key
      ? null
      : { key, triggerType: button.dataset.pickerType, triggerId: button.dataset.id, query: "", group: null };
    renderFiles();
    return true;
  }

  if (button.dataset.action === "choose-format-group") {
    event.stopPropagation();
    const key = pickerKey(button.dataset.pickerType, button.dataset.id);
    activeFormatPicker = {
      key,
      triggerType: button.dataset.pickerType,
      triggerId: button.dataset.id,
      query: "",
      group: button.dataset.group
    };
    renderFiles();
    return true;
  }

  if (button.dataset.action === "choose-format") {
    event.stopPropagation();
    if (button.dataset.pickerType === "bulk") {
      activeBulkFileTarget = button.dataset.value;
    } else {
      updateFileTarget(Number(button.dataset.id), button.dataset.value);
    }
    activeFormatPicker = null;
    renderFiles();
    return true;
  }

  return false;
}

function handleFormatPickerSearch(event) {
  const target = event.target;

  if (target.dataset.action !== "search-format") {
    return false;
  }

  const key = pickerKey(target.dataset.pickerType, target.dataset.id);
  const caret = target.selectionStart ?? target.value.length;
  activeFormatPicker = {
    key,
    triggerType: target.dataset.pickerType,
    triggerId: target.dataset.id,
    query: target.value,
    group: activeFormatPicker?.key === key ? activeFormatPicker.group : null
  };
  renderFiles();
  const searchInput = document.querySelector(`.format-search[data-picker-type="${target.dataset.pickerType}"][data-id="${target.dataset.id}"]`);
  if (searchInput) {
    searchInput.focus();
    searchInput.setSelectionRange(caret, caret);
  }
  return true;
}

bulkFileTarget.addEventListener("click", handleFormatPickerClick);
bulkFileTarget.addEventListener("input", handleFormatPickerSearch);

document.addEventListener("click", (event) => {
  if (activeFormatPicker && !event.target.closest(".format-picker-control")) {
    activeFormatPicker = null;
    renderFiles();
  }
});

document.addEventListener("wheel", (event) => {
  if (event.target.closest(".format-panel")) {
    event.stopPropagation();
  }
}, { capture: true, passive: true });

fileTableBody.addEventListener("input", (event) => {
  handleFormatPickerSearch(event);
});

fileTableBody.addEventListener("change", (event) => {
  const target = event.target;

  if (target.dataset.action === "select-file") {
    event.stopPropagation();
    setFileSelection(Number(target.dataset.id), target.checked);
  }
});

fileTableBody.addEventListener("click", (event) => {
  const target = event.target;

  if (target.dataset.action === "select-file") {
    event.stopPropagation();
    setFileSelection(Number(target.dataset.id), target.checked);
    return;
  }

  if (handleFormatPickerClick(event)) {
    return;
  }

  const button = event.target.closest("button[data-action]");

  if (button?.dataset.action === "remove") {
    removeFileQueueItem(Number(button.dataset.id));
  }
});

imagePdfGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");

  if (button?.dataset.action === "remove-image") {
    removeImagePdfItem(Number(button.dataset.id));
  }
});

imagePdfGrid.addEventListener("change", (event) => {
  const target = event.target;

  if (target.dataset.action === "select-image") {
    event.stopPropagation();
    setImageSelection(Number(target.dataset.id), target.checked);
  }
});

imagePdfGrid.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".image-card");

  if (!card || card.getAttribute("draggable") !== "true") {
    return;
  }

  draggedImageId = Number(card.dataset.id);
  card.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(draggedImageId));
});

imagePdfGrid.addEventListener("dragover", (event) => {
  if (draggedImageId === null) {
    return;
  }

  const card = event.target.closest(".image-card");

  if (card) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
});

imagePdfGrid.addEventListener("drop", (event) => {
  const card = event.target.closest(".image-card");

  if (!card) {
    return;
  }

  event.preventDefault();
  reorderImagePdf(draggedImageId, Number(card.dataset.id));
  draggedImageId = null;
});

imagePdfGrid.addEventListener("dragend", () => {
  draggedImageId = null;
  imagePdfGrid.querySelectorAll(".image-card").forEach((card) => card.classList.remove("is-dragging"));
});

imagePdfDpi.addEventListener("input", () => syncImagePdfDpi(imagePdfDpi.value));
imagePdfDpiNumber.addEventListener("input", () => syncImagePdfDpi(imagePdfDpiNumber.value));
imagePdfDpiNumber.addEventListener("blur", () => syncImagePdfDpi(imagePdfDpiNumber.value));

convertFilesButton.addEventListener("click", async () => {
  const output = outputRequest();

  if (!output) {
    return;
  }

  fileQueue = fileQueue.map((file) => ({
    ...file,
    status: file.kind === "unsupported" ? "unsupported" : "queued",
    message: file.kind === "unsupported" ? "Unsupported" : "Queued",
    outputPaths: []
  }));
  renderFiles();

  const request = {
    files: fileQueue
      .filter((file) => file.kind !== "unsupported")
      .map((file) => ({ id: file.id, path: file.path, target: file.target })),
    output,
    imageToPdfMode: "individual",
    documentPdfEngine: selectedDocumentPdfEngine(),
    pdfDpi: Number(pdfDpi.value)
  };

  convertFilesButton.disabled = true;

  try {
    const results = await window.converter.convert(request);
    await showConversionMessage(results, "File conversion");
  } catch (error) {
    for (const file of fileQueue.filter((item) => item.kind !== "unsupported")) {
      setFileStatus(file.id, "error", error.message || "Conversion failed");
    }
    await showConversionMessage(
      fileQueue
        .filter((item) => item.kind !== "unsupported")
        .map((item) => ({ id: item.id, status: "error", error: error.message })),
      "File conversion"
    );
  } finally {
    renderFiles();
  }
});

convertImagePdfButton.addEventListener("click", async () => {
  const output = outputRequest();

  if (!output) {
    return;
  }

  imagePdfQueue = imagePdfQueue.map((file) => ({
    ...file,
    status: file.kind === "image" ? "queued" : "unsupported",
    message: file.kind === "image" ? "Queued" : "Images only",
    outputPaths: []
  }));
  renderImagePdf();

  const request = {
    files: imagePdfQueue
      .filter((file) => file.kind === "image")
      .map((file) => ({ id: file.id, path: file.path, target: "pdf" })),
    output,
    imageToPdfMode: selectedRadio("imageToPdfMode"),
    documentPdfEngine: selectedDocumentPdfEngine(),
    imagePdfDpi: Number(imagePdfDpi.value),
    pdfDpi: Number(pdfDpi.value)
  };

  convertImagePdfButton.disabled = true;

  try {
    const results = await window.converter.convert(request);
    await showConversionMessage(results, "Image to PDF");
  } catch (error) {
    for (const file of imagePdfQueue.filter((item) => item.kind === "image")) {
      setFileStatus(file.id, "error", error.message || "Conversion failed");
    }
    await showConversionMessage(
      imagePdfQueue
        .filter((item) => item.kind === "image")
        .map((item) => ({ id: item.id, status: "error", error: error.message })),
      "Image to PDF"
    );
  } finally {
    renderImagePdf();
  }
});

window.converter.onConversionProgress((progress) => {
  setFileStatus(
    progress.id,
    progress.status,
    progress.message || progress.error || progress.status,
    progress.outputPaths || []
  );
});

installDropZone(filesDropZone, addFilePaths);
installDropZone(imagePdfDropZone, addImagePdfPaths);
loadSettings();
syncImagePdfDpi(150);
renderFiles();
renderImagePdf();
setActivePage("files");
