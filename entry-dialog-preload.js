const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("punch98EntryDialog", {
  onInit: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = (_event, payload) => {
      callback(payload);
    };

    ipcRenderer.on("entry-dialog:init", listener);
    return () => {
      ipcRenderer.removeListener("entry-dialog:init", listener);
    };
  },
  submit: (payload) => ipcRenderer.send("entry-dialog:submit", payload)
});
