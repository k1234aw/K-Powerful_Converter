const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("converter", {
  selectFiles: () => ipcRenderer.invoke("dialog:open-files"),
  selectOutputFolder: () => ipcRenderer.invoke("dialog:select-folder"),
  convert: (request) => ipcRenderer.invoke("conversion:start", request),
  showMessage: (options) => ipcRenderer.invoke("dialog:message", options),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onConversionProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);

    ipcRenderer.on("conversion:progress", listener);
    return () => ipcRenderer.removeListener("conversion:progress", listener);
  }
});
