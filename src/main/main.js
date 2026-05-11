const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

let mainWindow;
let conversionService = null;
const appIconPath = path.join(__dirname, "..", "renderer", "assets", "logo.ico");

function logStartup(message, detail = "") {
  try {
    const logPath = path.join(app.getPath("userData"), "startup.log");
    const line = `[${new Date().toISOString()}] ${message}${detail ? ` ${detail}` : ""}\n`;
    fs.appendFileSync(logPath, line);
  } catch {
    // Startup logging must never stop the app from opening.
  }
}

function getConversionService() {
  if (!conversionService) {
    conversionService = require("./services/conversion-service");
  }

  return conversionService;
}

function createWindow() {
  logStartup("createWindow");
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: "#f6f7f9",
    title: "Powerful Converter",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    logStartup("did-fail-load", `${errorCode} ${errorDescription}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logStartup("render-process-gone", JSON.stringify(details));
  });

  mainWindow.on("closed", () => {
    logStartup("window-closed");
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html")).catch((error) => {
    logStartup("loadFile-error", error.message);
  });
}

app.whenReady().then(() => {
  logStartup("app-ready");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  logStartup("app-ready-error", error.message);
});

app.on("window-all-closed", () => {
  logStartup("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

process.on("uncaughtException", (error) => {
  logStartup("uncaughtException", error.stack || error.message);
});

process.on("unhandledRejection", (error) => {
  logStartup("unhandledRejection", error?.stack || error?.message || String(error));
});

ipcMain.handle("dialog:open-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose files to convert",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Supported files",
        extensions: [
          "jpg",
          "jpeg",
          "png",
          "gif",
          "tiff",
          "tif",
          "bmp",
          "webp",
          "ico",
          "avif",
          "jp2",
          "j2k",
          "j2c",
          "jpx",
          "jxl",
          "svg",
          "svgz",
          "emf",
          "raw",
          "dng",
          "proraw",
          "cr2",
          "cr3",
          "nef",
          "nrw",
          "arw",
          "sr2",
          "srf",
          "rwl",
          "heic",
          "heif",
          "doc",
          "docx",
          "odt",
          "ppt",
          "pptx",
          "rtf",
          "txt",
          "xls",
          "xlsx",
          "pdf",
          "3gp",
          "avi",
          "flv",
          "mkv",
          "mov",
          "mp4",
          "ogv",
          "webm",
          "wmv",
          "ts",
          "aac",
          "aiff",
          "alac",
          "amr",
          "flac",
          "m4a",
          "mp3",
          "ogg",
          "wav",
          "wma"
        ]
      },
      {
        name: "Images",
        extensions: [
          "jpg",
          "jpeg",
          "png",
          "gif",
          "tiff",
          "tif",
          "bmp",
          "webp",
          "ico",
          "avif",
          "jp2",
          "j2k",
          "j2c",
          "jpx",
          "jxl",
          "svg",
          "svgz",
          "emf",
          "raw",
          "dng",
          "proraw",
          "cr2",
          "cr3",
          "nef",
          "nrw",
          "arw",
          "sr2",
          "srf",
          "rwl",
          "heic",
          "heif"
        ]
      },
      { name: "Documents", extensions: ["doc", "docx", "odt", "ppt", "pptx", "rtf", "txt", "xls", "xlsx", "pdf"] },
      { name: "Video", extensions: ["3gp", "avi", "flv", "mkv", "mov", "mp4", "ogv", "webm", "wmv", "ts"] },
      { name: "Audio", extensions: ["aac", "aiff", "alac", "amr", "flac", "m4a", "mp3", "ogg", "wav", "wma"] },
      { name: "PDF", extensions: ["pdf"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose output folder",
    properties: ["openDirectory", "createDirectory"]
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("conversion:start", async (_event, request) => {
  const sender = _event.sender;
  const { convertBatch } = getConversionService();

  return convertBatch(request, (progress) => {
    sender.send("conversion:progress", progress);
  });
});

ipcMain.handle("dialog:message", async (_event, options) => {
  await dialog.showMessageBox(mainWindow, {
    type: options.type || "info",
    title: options.title || "Powerful Converter",
    message: options.message || "",
    detail: options.detail || "",
    buttons: ["OK"]
  });
});
