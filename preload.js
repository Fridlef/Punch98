const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("punch98", {
  appName: "Punch98",
  closeWindow: () => ipcRenderer.send("window:hide"),
  getRenderingInfo: () => ipcRenderer.invoke("window:get-rendering-info"),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (payload) => ipcRenderer.invoke("settings:save", payload),
  browseLogFile: () => ipcRenderer.invoke("file:choose-logfile"),
  openEntryDialog: (payload) => ipcRenderer.invoke("entry-dialog:open", payload),
  openHelpLink: (payload) => ipcRenderer.invoke("help:open", payload),
  writeLogEntry: (payload) => ipcRenderer.invoke("log:write-entry", payload),
  reportTimerStatus: (payload) => ipcRenderer.send("timer:status", payload),
  updateGlobalShortcuts: (shortcuts) => ipcRenderer.send("hotkeys:update", shortcuts),
  showPopup: (payload) => ipcRenderer.send("popup:show", payload),
  onTimerAction: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = (_event, action) => {
      callback(action);
    };

    ipcRenderer.on("timer:action", listener);
    return () => {
      ipcRenderer.removeListener("timer:action", listener);
    };
  }
});
