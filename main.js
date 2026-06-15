const path = require("path");
const fs = require("fs");
const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  shell,
  screen,
  Tray,
  nativeImage
} = require("electron");

let mainWindow = null;
let popupWindow = null;
let popupWindowReadyPromise = null;
let isPopupWindowReady = false;
let entryDialogWindow = null;
let entryDialogWindowReadyPromise = null;
let isEntryDialogWindowReady = false;
let popupHideTimeoutId = null;
let popupRequestId = 0;
let popupRequestState = null;
const lastPopupSize = {
  width: 1,
  height: 1
};
let entryDialogState = null;
let tray = null;
let isQuitting = false;
let trayTooltip = "Punch98";
let currentTrayState = "idle";
let registeredHotkeys = {
  start: null,
  stop: null,
  cancel: null
};

const POPUP_MARGIN = 12;

function getSettingsFilePath() {
  return path.join(app.getPath("appData"), "Punch98", "settings.json");
}

function getDefaultLogFilePath() {
  return path.join(path.dirname(app.getPath("exe")), "Punch98-log.txt");
}

function resolveAssetPath(fileName) {
  const candidates = [
    path.join(process.resourcesPath, "assets", fileName),
    path.join(__dirname, "assets", fileName)
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[candidates.length - 1];
}

function loadIcon(fileName) {
  return nativeImage.createFromPath(resolveAssetPath(fileName));
}

const APP_ICON_PATH = resolveAssetPath("punch98.ico");
const TRAY_ICONS = {
  idle: loadIcon("punch98.ico"),
  running_below_threshold: loadIcon("green.ico"),
  running_above_threshold: loadIcon("red.ico")
};

const ACCELERATOR_PARTS = {
  Ctrl: "CommandOrControl",
  Meta: process.platform === "darwin" ? "Command" : "Super",
  Escape: "Esc",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right"
};

function getTrayIconForState(state) {
  const icon = TRAY_ICONS[state] ?? TRAY_ICONS.idle;
  return icon && !icon.isEmpty() ? icon : TRAY_ICONS.idle;
}

function toAccelerator(shortcutText) {
  if (typeof shortcutText !== "string" || shortcutText.trim() === "") {
    return null;
  }

  return shortcutText
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ACCELERATOR_PARTS[part] ?? part)
    .join("+");
}

function registerShortcut(action, accelerator) {
  if (!accelerator) {
    return false;
  }

  try {
    return globalShortcut.register(accelerator, () => {
      sendRendererCommand(action);
    });
  } catch (error) {
    console.warn(`Unable to register ${action} shortcut (${accelerator}).`, error);
    return false;
  }
}

function restorePreviousHotkeys(previousBindings, changedActions) {
  changedActions.forEach((action) => {
    const previous = previousBindings[action];

    if (previous?.accelerator) {
      registerShortcut(action, previous.accelerator);
    }
  });

  registeredHotkeys = previousBindings;
}

function updateGlobalShortcuts(shortcuts) {
  const desiredBindings = {
    start: {
      shortcut: shortcuts?.start ?? null,
      accelerator: toAccelerator(shortcuts?.start ?? null)
    },
    stop: {
      shortcut: shortcuts?.stop ?? null,
      accelerator: toAccelerator(shortcuts?.stop ?? null)
    },
    cancel: {
      shortcut: shortcuts?.cancel ?? null,
      accelerator: toAccelerator(shortcuts?.cancel ?? null)
    }
  };

  const previousBindings = {
    start: registeredHotkeys.start ? { ...registeredHotkeys.start } : null,
    stop: registeredHotkeys.stop ? { ...registeredHotkeys.stop } : null,
    cancel: registeredHotkeys.cancel ? { ...registeredHotkeys.cancel } : null
  };

  const changedActions = Object.keys(desiredBindings).filter((action) => {
    const previous = previousBindings[action];
    const desired = desiredBindings[action];

    return previous?.accelerator !== desired.accelerator || previous?.shortcut !== desired.shortcut;
  });

  if (changedActions.length === 0) {
    return;
  }

  changedActions.forEach((action) => {
    const previous = previousBindings[action];

    if (previous?.accelerator) {
      globalShortcut.unregister(previous.accelerator);
    }
  });

  const failedActions = [];
  const successfulActions = [];

  changedActions.forEach((action) => {
    const desired = desiredBindings[action];

    if (!desired.accelerator) {
      failedActions.push(action);
      console.warn(`Unable to register ${action} shortcut. Accelerator is invalid.`);
      return;
    }

    if (registerShortcut(action, desired.accelerator)) {
      successfulActions.push(action);
      return;
    }

    failedActions.push(action);
    console.warn(
      `Unable to register ${action} shortcut (${desired.shortcut}). Keeping previous shortcut.`
    );
  });

  if (failedActions.length > 0) {
    successfulActions.forEach((action) => {
      const desired = desiredBindings[action];

      if (desired.accelerator) {
        globalShortcut.unregister(desired.accelerator);
      }
    });

    restorePreviousHotkeys(previousBindings, changedActions);
    return;
  }

  registeredHotkeys = {
    ...registeredHotkeys,
    ...desiredBindings
  };
}

function unregisterAllHotkeys() {
  globalShortcut.unregisterAll();
  registeredHotkeys = {
    start: null,
    stop: null,
    cancel: null
  };
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Start",
      click: () => {
        sendRendererCommand("start");
      }
    },
    {
      label: "Stop",
      click: () => {
        sendRendererCommand("stop");
      }
    },
    { type: "separator" },
    {
      label: "Exit",
      click: () => {
        exitApp();
      }
    }
  ]);
}

function updateTrayIcon(state) {
  currentTrayState = state || "idle";

  if (tray) {
    tray.setImage(getTrayIconForState(currentTrayState));
  }
}

function updateTrayTooltip(text) {
  trayTooltip = text || "Punch98";

  if (tray) {
    tray.setToolTip(trayTooltip);
  }
}

function createTray() {
  if (tray) {
    return tray;
  }

  tray = new Tray(getTrayIconForState(currentTrayState));
  tray.setContextMenu(buildTrayMenu());
  updateTrayTooltip(trayTooltip);

  tray.on("double-click", () => {
    showMainWindow();
  });

  return tray;
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 480,
    height: 360,
    minWidth: 460,
    minHeight: 340,
    show: false,
    frame: false,
    roundedCorners: false,
    resizable: true,
    autoHideMenuBar: true,
    useContentSize: true,
    backgroundColor: "#c0c0c0",
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1
    }
  });

  mainWindow.webContents.setZoomFactor(1);
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function getEntryDialogBounds(width, height) {
  const workArea = screen.getPrimaryDisplay().workArea;
  const dialogWidth = Math.max(1, Math.ceil(width));
  const dialogHeight = Math.max(1, Math.ceil(height));

  return {
    x: workArea.x + Math.round((workArea.width - dialogWidth) / 2),
    y: workArea.y + Math.round((workArea.height - dialogHeight) / 2),
    width: dialogWidth,
    height: dialogHeight
  };
}

function getPopupBounds(position, width, height) {
  const workArea = screen.getPrimaryDisplay().workArea;
  const popupWidth = Math.max(1, Math.ceil(width));
  const popupHeight = Math.max(1, Math.ceil(height));
  const centeredX = workArea.x + Math.round((workArea.width - popupWidth) / 2);
  const centeredY = workArea.y + Math.round((workArea.height - popupHeight) / 2);

  switch (position) {
    case "Top-left":
      return { x: workArea.x + POPUP_MARGIN, y: workArea.y + POPUP_MARGIN, width: popupWidth, height: popupHeight };
    case "Top-right":
      return {
        x: workArea.x + workArea.width - popupWidth - POPUP_MARGIN,
        y: workArea.y + POPUP_MARGIN,
        width: popupWidth,
        height: popupHeight
      };
    case "Bottom-left":
      return {
        x: workArea.x + POPUP_MARGIN,
        y: workArea.y + workArea.height - popupHeight - POPUP_MARGIN,
        width: popupWidth,
        height: popupHeight
      };
    case "Bottom-right":
      return {
        x: workArea.x + workArea.width - popupWidth - POPUP_MARGIN,
        y: workArea.y + workArea.height - popupHeight - POPUP_MARGIN,
        width: popupWidth,
        height: popupHeight
      };
    case "Center":
    default:
      return { x: centeredX, y: centeredY, width: popupWidth, height: popupHeight };
  }
}

function clearPopupHideTimer() {
  if (popupHideTimeoutId !== null) {
    clearTimeout(popupHideTimeoutId);
    popupHideTimeoutId = null;
  }
}

function hidePopupWindow(expectedRequestId = null) {
  if (expectedRequestId !== null) {
    if (!popupRequestState || popupRequestState.id !== expectedRequestId) {
      return;
    }
  }

  clearPopupHideTimer();
  popupRequestState = null;

  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.hide();
  }
}

function schedulePopupHide(requestState) {
  clearPopupHideTimer();

  popupHideTimeoutId = setTimeout(() => {
    hidePopupWindow(requestState.id);
  }, requestState.durationMs);
}

function showPopupWindow(requestState, size = lastPopupSize) {
  if (!popupWindow || popupWindow.isDestroyed()) {
    return;
  }

  const bounds = getPopupBounds(
    requestState.position,
    Math.max(1, Number(size?.width) || 1),
    Math.max(1, Number(size?.height) || 1)
  );

  popupWindow.setBounds(bounds, false);

  if (typeof popupWindow.showInactive === "function") {
    popupWindow.showInactive();
  } else {
    popupWindow.show();
  }

  schedulePopupHide(requestState);
}

function destroyPopupWindow() {
  clearPopupHideTimer();

  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.destroy();
  }

  popupWindow = null;
  popupRequestState = null;
  popupWindowReadyPromise = null;
  isPopupWindowReady = false;
}

function createPopupWindow() {
  const popup = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    frame: false,
    roundedCorners: false,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    focusable: false,
    backgroundColor: "#00000000",
    useContentSize: true,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "popup-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1,
      backgroundThrottling: false
    }
  });

  popup.webContents.setZoomFactor(1);
  popup.webContents.setVisualZoomLevelLimits(1, 1);
  popup.setAlwaysOnTop(true, "screen-saver");
  popup.setVisibleOnAllWorkspaces(false);
  popup.setMenuBarVisibility(false);
  popup.setSkipTaskbar(true);
  popup.setIgnoreMouseEvents(true);

  popup.on("closed", () => {
    if (popupWindow === popup) {
      popupWindow = null;
      popupRequestState = null;
      popupWindowReadyPromise = null;
      isPopupWindowReady = false;
      clearPopupHideTimer();
    }
  });

  return popup;
}

function ensurePopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    if (isPopupWindowReady) {
      return Promise.resolve(popupWindow);
    }

    return popupWindowReadyPromise;
  }

  popupWindow = createPopupWindow();
  isPopupWindowReady = false;
  popupWindowReadyPromise = popupWindow
    .loadFile(path.join(__dirname, "src", "popup.html"))
    .then(() => {
      if (popupWindow && !popupWindow.isDestroyed()) {
        isPopupWindowReady = true;
      }

      return popupWindow;
    })
    .catch((error) => {
      destroyPopupWindow();
      throw error;
    });

  return popupWindowReadyPromise;
}

function hideEntryDialogWindow() {
  if (entryDialogWindow && !entryDialogWindow.isDestroyed()) {
    entryDialogWindow.hide();
  }
}

function destroyEntryDialogWindow() {
  if (entryDialogWindow && !entryDialogWindow.isDestroyed()) {
    entryDialogWindow.destroy();
  }

  entryDialogWindow = null;
  entryDialogWindowReadyPromise = null;
  isEntryDialogWindowReady = false;
}

function resolveEntryDialog(resultOverrides = {}) {
  if (!entryDialogState) {
    return;
  }

  const { resolve, payload } = entryDialogState;
  const result = {
    ...payload,
    text: "",
    canceled: true,
    ...resultOverrides
  };

  entryDialogState = null;
  hideEntryDialogWindow();
  resolve(result);
}

function createEntryDialogWindow() {
  const dialogWindow = new BrowserWindow({
    width: 376,
    height: 118,
    show: false,
    center: true,
    frame: false,
    roundedCorners: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    useContentSize: true,
    backgroundColor: "#c0c0c0",
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "entry-dialog-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1,
      backgroundThrottling: false
    }
  });

  dialogWindow.webContents.setZoomFactor(1);
  dialogWindow.webContents.setVisualZoomLevelLimits(1, 1);
  dialogWindow.setAlwaysOnTop(true, "screen-saver");
  dialogWindow.setMenuBarVisibility(false);

  dialogWindow.on("close", (event) => {
    if (!entryDialogState) {
      return;
    }

    event.preventDefault();
    resolveEntryDialog({ canceled: true });
  });

  dialogWindow.on("closed", () => {
    if (entryDialogWindow === dialogWindow) {
      entryDialogWindow = null;
      entryDialogWindowReadyPromise = null;
      isEntryDialogWindowReady = false;
    }

    if (entryDialogState) {
      const { resolve, payload } = entryDialogState;
      entryDialogState = null;
      resolve({
        ...payload,
        text: "",
        canceled: true
      });
    }
  });

  return dialogWindow;
}

function ensureEntryDialogWindow() {
  if (entryDialogWindow && !entryDialogWindow.isDestroyed()) {
    if (isEntryDialogWindowReady) {
      return Promise.resolve(entryDialogWindow);
    }

    return entryDialogWindowReadyPromise;
  }

  entryDialogWindow = createEntryDialogWindow();
  isEntryDialogWindowReady = false;
  entryDialogWindowReadyPromise = entryDialogWindow
    .loadFile(path.join(__dirname, "src", "entry-dialog.html"))
    .then(() => {
      if (entryDialogWindow && !entryDialogWindow.isDestroyed()) {
        isEntryDialogWindowReady = true;
      }

      return entryDialogWindow;
    })
    .catch((error) => {
      destroyEntryDialogWindow();
      throw error;
    });

  return entryDialogWindowReadyPromise;
}

async function openEntryDialog(payload) {
  if (entryDialogState) {
    if (entryDialogWindow && !entryDialogWindow.isDestroyed()) {
      entryDialogWindow.focus();
    }

    return entryDialogState.promise;
  }

  const normalizedPayload = {
    title: payload?.title || "Punch98 note",
    elapsedText: payload?.elapsedText || "00:00:00",
    startTime: payload?.startTime ?? null,
    endTime: payload?.endTime ?? null,
    duration:
      payload?.duration != null
        ? payload.duration
        : payload?.elapsedText != null
          ? payload.elapsedText
          : "00:00:00"
  };

  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  entryDialogState = {
    payload: normalizedPayload,
    promise,
    resolve: resolvePromise
  };

  try {
    const dialogWindow = await ensureEntryDialogWindow();

    if (!dialogWindow || dialogWindow.isDestroyed() || !entryDialogState) {
      return promise;
    }

    const { width, height } = dialogWindow.getBounds();
    dialogWindow.setBounds(getEntryDialogBounds(width, height), false);
    dialogWindow.webContents.send("entry-dialog:init", entryDialogState.payload);
    dialogWindow.show();
    dialogWindow.focus();
  } catch (error) {
    console.warn("Unable to prepare entry dialog.", error);
    resolveEntryDialog({ canceled: true });
  }

  return promise;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function formatLogDate(date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function formatLogTime(date) {
  return `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;
}

function normalizeEntryText(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, " ")
    .trim();
}

function buildLogEntryLine(payload) {
  const startDate = new Date(payload.startTime);
  const endDate = new Date(payload.endTime);
  const canceledPrefix = payload.canceled ? "canceled " : "";
  const noteText = normalizeEntryText(payload.text);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Entry timestamps are invalid.");
  }

  return {
    dateHeader: formatLogDate(startDate),
    line: `\t${canceledPrefix}${formatLogTime(startDate)} - ${formatLogTime(endDate)} (${payload.duration || "00:00:00"}) | ${noteText}`
  };
}

async function loadPersistedSettings() {
  const settingsFilePath = getSettingsFilePath();

  try {
    const rawContent = await fs.promises.readFile(settingsFilePath, "utf8");
    const parsedSettings = JSON.parse(rawContent);

    if (!parsedSettings || Array.isArray(parsedSettings) || typeof parsedSettings !== "object") {
      throw new Error("Settings file must contain a JSON object.");
    }

    return parsedSettings;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    console.warn("Unable to load settings. Falling back to defaults.", error);
    return null;
  }
}

async function savePersistedSettings(settings) {
  const settingsFilePath = getSettingsFilePath();
  const settingsDirectory = path.dirname(settingsFilePath);

  await fs.promises.mkdir(settingsDirectory, { recursive: true });
  await fs.promises.writeFile(settingsFilePath, `${JSON.stringify(settings ?? {}, null, 2)}\r\n`, "utf8");
}

async function writeLogEntry(payload) {
  let filePath = typeof payload?.filePath === "string" ? payload.filePath.trim() : "";
  const usedDefaultPath = filePath === "";

  if (usedDefaultPath) {
    filePath = getDefaultLogFilePath();
  }

  const { dateHeader, line } = buildLogEntryLine(payload);
  const directoryPath = path.dirname(filePath);

  await fs.promises.mkdir(directoryPath, { recursive: true });

  let existingContent = "";
  let fileAlreadyExists = true;

  try {
    existingContent = await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }

    fileAlreadyExists = false;
  }

  const normalizedContent = existingContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  const blocks =
    normalizedContent === ""
      ? []
      : normalizedContent.split(/\n{2,}/).map((block) => {
          return block
            .split("\n")
            .map((entryLine) => entryLine.trimEnd())
            .filter(Boolean);
        });

  const existingBlock = blocks.find((block) => block[0] === dateHeader);

  if (existingBlock) {
    existingBlock.push(line);
  } else {
    blocks.push([dateHeader, line]);
  }

  const nextContent = `${blocks.map((block) => block.join("\r\n")).join("\r\n\r\n")}\r\n`;
  await fs.promises.writeFile(filePath, nextContent, "utf8");

  return {
    ok: true,
    filePath,
    usedDefaultPath,
    createdFile: !fileAlreadyExists
  };
}

function showPopup(payload) {
  if (!payload?.message) {
    return;
  }

  popupRequestId += 1;
  popupRequestState = {
    id: popupRequestId,
    message: String(payload.message),
    position: payload.position || "Center",
    durationMs: Math.max(1000, Number(payload.durationMs) || 2000)
  };

  const requestState = { ...popupRequestState };

  void ensurePopupWindow()
    .then((popup) => {
      if (!popup || popup.isDestroyed() || !popupRequestState) {
        return;
      }

      if (popupRequestState.id !== requestState.id) {
        return;
      }

      popup.webContents.send("popup:update", {
        requestId: requestState.id,
        message: requestState.message
      });

      showPopupWindow(requestState);
    })
    .catch((error) => {
      console.warn("Unable to prepare popup window.", error);
    });
}

function showMainWindow() {
  const window = createMainWindow();

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function sendRendererCommand(action) {
  const window = createMainWindow();
  const deliver = () => {
    if (!window.isDestroyed()) {
      window.webContents.send("timer:action", action);
    }
  };

  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once("did-finish-load", deliver);
    return;
  }

  deliver();
}

function exitApp() {
  isQuitting = true;
  unregisterAllHotkeys();
  destroyPopupWindow();
  destroyEntryDialogWindow();

  if (tray) {
    tray.destroy();
    tray = null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }

  app.quit();
}

app.whenReady().then(() => {
  ipcMain.handle("window:get-rendering-info", (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    const webContents = currentWindow?.webContents ?? event.sender;

    return {
      zoomFactor: webContents.getZoomFactor(),
      zoomLevel: webContents.getZoomLevel()
    };
  });

  ipcMain.handle("file:choose-logfile", async (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(currentWindow, {
      title: "Choose log file",
      properties: ["openFile"],
      defaultPath: "punch98.txt",
      filters: [
        { name: "Text files", extensions: ["txt"] },
        { name: "All files", extensions: ["*"] }
      ]
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("settings:load", async () => {
    return loadPersistedSettings();
  });

  ipcMain.handle("settings:save", async (_event, payload) => {
    await savePersistedSettings(payload);
    return { ok: true };
  });

  ipcMain.handle("entry-dialog:open", async (_event, payload) => {
    return openEntryDialog(payload);
  });

  ipcMain.handle("log:write-entry", async (_event, payload) => {
    return writeLogEntry(payload);
  });

  ipcMain.handle("help:open", async (_event, payload) => {
    const targetUrl = typeof payload?.url === "string" ? payload.url.trim() : "";

    try {
      const normalizedUrl = new URL(targetUrl).toString();
      await shell.openExternal(normalizedUrl);
      return { ok: true };
    } catch (error) {
      console.warn("Unable to open help link.", error);
      return { ok: false };
    }
  });

  ipcMain.on("window:hide", () => {
    hideMainWindow();
  });

  ipcMain.on("entry-dialog:submit", (_event, payload) => {
    resolveEntryDialog({
      text: typeof payload?.text === "string" ? payload.text : "",
      canceled: Boolean(payload?.canceled)
    });
  });

  ipcMain.on("timer:status", (_event, payload) => {
    const timerState = payload?.state || "idle";

    updateTrayIcon(timerState);

    if (timerState === "idle") {
      updateTrayTooltip("Punch98");
      return;
    }

    updateTrayTooltip(payload?.elapsedText || "Punch98");
  });

  ipcMain.on("hotkeys:update", (_event, shortcuts) => {
    updateGlobalShortcuts(shortcuts);
  });

  ipcMain.on("popup:show", (_event, payload) => {
    showPopup(payload);
  });

  ipcMain.on("popup:resize", (_event, payload) => {
    if (!popupWindow || popupWindow.isDestroyed() || !popupRequestState) {
      return;
    }

    if (payload?.requestId !== popupRequestState.id) {
      return;
    }

    lastPopupSize.width = Math.max(1, Number(payload?.width) || 1);
    lastPopupSize.height = Math.max(1, Number(payload?.height) || 1);
    showPopupWindow(popupRequestState, lastPopupSize);
  });

  createMainWindow();
  createTray();
  void ensurePopupWindow();
  void ensureEntryDialogWindow();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  unregisterAllHotkeys();
  destroyPopupWindow();
  destroyEntryDialogWindow();
});

app.on("window-all-closed", (event) => {
  if (!isQuitting) {
    event.preventDefault();
  }
});





