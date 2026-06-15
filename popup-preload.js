const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("punch98Popup", {
  onUpdate: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = (_event, payload) => {
      callback(payload);
    };

    ipcRenderer.on("popup:update", listener);
    return () => {
      ipcRenderer.removeListener("popup:update", listener);
    };
  },
  reportSize: (payload) => ipcRenderer.send("popup:resize", payload)
});
