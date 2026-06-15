const tabs = Array.from(document.querySelectorAll("menu[role='tablist'] > [role='tab']"));
const tabPanel = document.querySelector("[role='tabpanel']");
const tabViews = Array.from(document.querySelectorAll(".tab-panel"));
const helpButton = document.querySelector(".title-bar-controls button[aria-label='Help']");
const closeButton = document.querySelector(".title-bar-controls button[aria-label='Close']");
const okButton = document.querySelector("#ok-button");
const cancelButton = document.querySelector("#cancel-button");
const applyButton = document.querySelector("#apply-button");
const statusBarField = document.querySelector(".thin-status-bar .status-bar-field");
const shortcutButtons = Array.from(document.querySelectorAll(".shortcut-button"));
const shortcutMessage = document.querySelector("#shortcut-message");
const presetButtons = Array.from(document.querySelectorAll(".preset-button"));
const manualThresholdInput = document.querySelector("#manual-threshold");
const spinnerButtons = Array.from(document.querySelectorAll(".spinner-button"));
const logFilePathInput = document.querySelector("#log-file-path");
const browseLogFileButton = document.querySelector("#browse-log-file");
const settingsControls = Array.from(document.querySelectorAll("[data-settings-key]"));
const settingsSpinnerButtons = Array.from(document.querySelectorAll(".settings-spinner-button"));
const restoreSettingsDefaultsButton = document.querySelector("#restore-settings-defaults");

const TIMER_STATES = {
  idle: "idle",
  runningBelowThreshold: "running_below_threshold",
  runningAboveThreshold: "running_above_threshold"
};

const STATUS_COLORS = {
  runningBelowThreshold: "#008000",
  runningAboveThreshold: "#a80000"
};

const SHORTCUT_KEYS = {
  start: "shortcutStart",
  stop: "shortcutStop",
  cancel: "shortcutCancel"
};

const PRESET_SETTING_KEYS = ["preset1", "preset2", "preset3"];

const shortcutLabels = {
  start: "Start",
  stop: "Stop",
  cancel: "Cancel"
};

const SETTINGS_DEFAULTS = Object.freeze({
  shortcutStart: "Ctrl+Shift+Home",
  shortcutStop: "Ctrl+Shift+End",
  shortcutCancel: "Ctrl+Alt+End",
  entryDialogTitle: "Punch98 note",
  thresholdSeconds: 300,
  logFilePath: "",
  preset1: "00:05",
  preset2: "05:00",
  preset3: "08:00",
  popupNotificationsEnabled: true,
  popupPosition: "Center",
  popupDurationMs: 10,
  helpUrl: "https://www.google.com",
  timerStarted: "Timer started",
  timerStopped: "Timer stopped",
  timerAlreadyRunning: "Timer is already running",
  timerNotRunning: "Timer is not running",
  thresholdNotReached: "Recording threshold not reached",
  entrySaved: "Entry saved",
  timerCanceled: "Timer canceled",
  unfinishedTimerDetected: "Unfinished timer detected from HH:MM:SS"
});

const SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS);

const SETTINGS_TAB_KEYS = [
  "preset1",
  "preset2",
  "preset3",
  "popupNotificationsEnabled",
  "popupPosition",
  "popupDurationMs",
  "helpUrl",
  "timerStarted",
  "timerStopped",
  "timerAlreadyRunning",
  "timerNotRunning",
  "thresholdNotReached",
  "entrySaved",
  "timerCanceled",
  "unfinishedTimerDetected"
];

const TEMPORARY_MESSAGES = Object.freeze({
  failedToSaveEntry: "Failed to save entry",
  failedToOpenHelpLink: "Failed to open help link"
});

const timerModel = {
  startTimestamp: null,
  elapsedSeconds: 0,
  thresholdSeconds: SETTINGS_DEFAULTS.thresholdSeconds,
  state: TIMER_STATES.idle
};

let appliedSettings = createSettingsSnapshot();
let pendingSettings = createSettingsSnapshot();
let captureAction = null;
let captureCleanup = null;
let timerIntervalId = null;
let isEntryDialogOpen = false;
let isSettingsReady = false;
const queuedTimerActions = [];
const removeTimerActionListener = window.punch98?.onTimerAction?.((action) => {
  if (!isSettingsReady) {
    queuedTimerActions.push(action);
    return;
  }

  handleTimerAction(action);
}) ?? (() => {});

function createSettingsSnapshot(overrides = {}) {
  return {
    ...SETTINGS_DEFAULTS,
    ...overrides
  };
}

function handleTimerAction(action) {
  if (action === "start") {
    startTimer();
  }

  if (action === "stop") {
    stopTimer();
  }

  if (action === "cancel") {
    cancelTimer();
  }
}

function flushQueuedTimerActions() {
  while (queuedTimerActions.length > 0) {
    handleTimerAction(queuedTimerActions.shift());
  }
}

function cloneSettings(settings) {
  return { ...settings };
}

function clampPopupDurationMs(value) {
  const parsedValue = Number.parseInt(String(value ?? "").trim(), 10);

  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return Math.min(10000, Math.max(1, parsedValue));
}

function normalizePopupDurationMsInput(value, fallbackMs) {
  return clampPopupDurationMs(value) ?? fallbackMs;
}

function getMigratedPopupDurationMs(savedSettings) {
  if (!savedSettings || typeof savedSettings !== "object") {
    return SETTINGS_DEFAULTS.popupDurationMs;
  }

  if (savedSettings.popupDurationMs !== undefined) {
    return clampPopupDurationMs(savedSettings.popupDurationMs) ?? SETTINGS_DEFAULTS.popupDurationMs;
  }

  if (typeof savedSettings.popupDuration === "string") {
    const seconds = parseDuration(savedSettings.popupDuration);
    return seconds === null
      ? SETTINGS_DEFAULTS.popupDurationMs
      : clampPopupDurationMs(seconds * 1000) ?? SETTINGS_DEFAULTS.popupDurationMs;
  }

  if (savedSettings.popupDuration !== undefined) {
    const seconds = Number(savedSettings.popupDuration);

    if (Number.isFinite(seconds)) {
      return clampPopupDurationMs(seconds * 1000) ?? SETTINGS_DEFAULTS.popupDurationMs;
    }
  }

  return SETTINGS_DEFAULTS.popupDurationMs;
}

function normalizeLoadedSettings(savedSettings) {
  const normalizedSettings = createSettingsSnapshot();

  if (!savedSettings || Array.isArray(savedSettings) || typeof savedSettings !== "object") {
    return normalizedSettings;
  }

  SETTINGS_KEYS.forEach((key) => {
    if (key in savedSettings) {
      normalizedSettings[key] = savedSettings[key];
    }
  });

  normalizedSettings.popupNotificationsEnabled = savedSettings.popupNotificationsEnabled !== false;
  normalizedSettings.popupDurationMs = getMigratedPopupDurationMs(savedSettings);

  return normalizedSettings;
}

async function loadAppliedSettings() {
  if (!window.punch98?.loadSettings) {
    return createSettingsSnapshot();
  }

  try {
    const savedSettings = await window.punch98.loadSettings();
    return normalizeLoadedSettings(savedSettings ?? {});
  } catch (error) {
    console.warn("Unable to load persisted settings.", error);
    return createSettingsSnapshot();
  }
}

async function persistAppliedSettings() {
  if (!window.punch98?.saveSettings) {
    return false;
  }

  try {
    const result = await window.punch98.saveSettings(appliedSettings);
    return Boolean(result?.ok);
  } catch (error) {
    console.warn("Unable to save settings.", error);
    return false;
  }
}

function areSettingsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clampDuration(seconds) {
  return Math.min(59 * 60, Math.max(1, seconds));
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatElapsed(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function parseDuration(value) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  const match = normalizedValue.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);

  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);

  if (Number.isNaN(minutes) || Number.isNaN(seconds) || seconds > 59) {
    return null;
  }

  return clampDuration(minutes * 60 + seconds);
}

function normalizeDurationInput(value, fallbackSeconds) {
  const parsedValue = parseDuration(value);
  return parsedValue === null ? fallbackSeconds : parsedValue;
}

function getPopupDurationMs() {
  return clampPopupDurationMs(appliedSettings.popupDurationMs) ?? SETTINGS_DEFAULTS.popupDurationMs;
}

function showPopupMessage(message) {
  if (!message || !window.punch98?.showPopup || !appliedSettings.popupNotificationsEnabled) {
    return;
  }

  window.punch98.showPopup({
    message,
    position: appliedSettings.popupPosition,
    durationMs: getPopupDurationMs()
  });
}

function closeWindow() {
  if (window.punch98?.closeWindow) {
    window.punch98.closeWindow();
    return;
  }

  window.close();
}

async function openHelpLink() {
  const helpUrl =
    typeof appliedSettings.helpUrl === "string" && appliedSettings.helpUrl.trim() !== ""
      ? appliedSettings.helpUrl.trim()
      : SETTINGS_DEFAULTS.helpUrl;

  try {
    const result = await window.punch98?.openHelpLink?.({ url: helpUrl });

    if (!result?.ok) {
      throw new Error("Help link could not be opened.");
    }
  } catch (error) {
    console.error("Unable to open help link.", error);
    showPopupMessage(TEMPORARY_MESSAGES.failedToOpenHelpLink);
  }
}

function formatEntryTimestamp(timestamp) {
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

async function openEntryDialog(session) {
  if (!window.punch98?.openEntryDialog) {
    return null;
  }

  try {
    return await window.punch98.openEntryDialog({
      title: appliedSettings.entryDialogTitle || SETTINGS_DEFAULTS.entryDialogTitle,
      elapsedText: formatElapsed(session.durationSeconds),
      startTime: formatEntryTimestamp(session.startTimestamp),
      endTime: formatEntryTimestamp(session.endTimestamp),
      duration: formatElapsed(session.durationSeconds)
    });
  } catch (error) {
    console.warn("Unable to open entry dialog.", error);
    return null;
  }
}

async function syncResolvedLogFilePath(filePath) {
  const resolvedPath = typeof filePath === "string" ? filePath.trim() : "";

  if (resolvedPath === "" || appliedSettings.logFilePath === resolvedPath) {
    return;
  }

  const previousAppliedPath = appliedSettings.logFilePath;
  appliedSettings.logFilePath = resolvedPath;

  if (pendingSettings.logFilePath === previousAppliedPath) {
    pendingSettings.logFilePath = resolvedPath;
    syncLogFilePathUi();
  }

  syncApplyButton();
  await persistAppliedSettings();
}

async function saveLogEntry(entryResult) {
  if (!entryResult || !window.punch98?.writeLogEntry) {
    return null;
  }

  try {
    const result = await window.punch98.writeLogEntry({
      filePath: appliedSettings.logFilePath,
      startTime: entryResult.startTime,
      endTime: entryResult.endTime,
      duration: entryResult.duration,
      text: entryResult.text,
      canceled: entryResult.canceled
    });

    if (result?.filePath) {
      await syncResolvedLogFilePath(result.filePath);
    }

    return result ?? null;
  } catch (error) {
    console.error("Unable to write log entry.", error);
    return null;
  }
}

function syncMainHotkeys() {
  if (!window.punch98?.updateGlobalShortcuts) {
    return;
  }

  window.punch98.updateGlobalShortcuts({
    start: appliedSettings.shortcutStart,
    stop: appliedSettings.shortcutStop,
    cancel: appliedSettings.shortcutCancel
  });
}

function reportTimerStatus() {
  if (!window.punch98?.reportTimerStatus) {
    return;
  }

  if (timerModel.state === TIMER_STATES.idle) {
    window.punch98.reportTimerStatus({
      state: TIMER_STATES.idle,
      elapsedText: null
    });
    return;
  }

  window.punch98.reportTimerStatus({
    state: timerModel.state,
    elapsedText: formatElapsed(timerModel.elapsedSeconds)
  });
}

function syncApplyButton() {
  if (applyButton) {
    applyButton.disabled = areSettingsEqual(pendingSettings, appliedSettings);
  }
}

function getShortcutValue(action, source = pendingSettings) {
  return source[SHORTCUT_KEYS[action]];
}

function setPendingShortcutValue(action, value) {
  pendingSettings[SHORTCUT_KEYS[action]] = value;
  syncShortcutUi();
  syncApplyButton();
}

function syncShortcutUi() {
  shortcutButtons.forEach((button) => {
    const action = button.dataset.shortcutAction;

    if (!action || captureAction === action) {
      return;
    }

    button.textContent = getShortcutValue(action);
  });
}

function syncThresholdUi() {
  if (manualThresholdInput) {
    manualThresholdInput.value = formatDuration(pendingSettings.thresholdSeconds);
  }

  presetButtons.forEach((button) => {
    const isSelected = Number(button.dataset.presetSeconds) === pendingSettings.thresholdSeconds;
    button.classList.toggle("is-selected", isSelected);
  });
}

function syncTimePresetButtons() {
  presetButtons.forEach((button, index) => {
    const settingsKey = PRESET_SETTING_KEYS[index];

    if (!settingsKey) {
      return;
    }

    const presetValue = appliedSettings[settingsKey] ?? SETTINGS_DEFAULTS[settingsKey];
    const presetSeconds =
      parseDuration(presetValue) ?? parseDuration(SETTINGS_DEFAULTS[settingsKey]) ?? 300;

    button.dataset.presetSeconds = String(presetSeconds);
    button.textContent = formatDuration(presetSeconds);
  });
}

function setPendingThresholdSeconds(seconds) {
  pendingSettings.thresholdSeconds = clampDuration(seconds);
  syncThresholdUi();
  syncApplyButton();
}

function commitManualThreshold() {
  if (!manualThresholdInput) {
    return;
  }

  setPendingThresholdSeconds(
    normalizeDurationInput(manualThresholdInput.value, pendingSettings.thresholdSeconds)
  );
}

function syncLogFilePathUi() {
  if (logFilePathInput) {
    logFilePathInput.value = pendingSettings.logFilePath;
  }
}

function setPendingLogFilePath(value) {
  pendingSettings.logFilePath = value;
  syncLogFilePathUi();
  syncApplyButton();
}

function getSettingsControl(key) {
  return settingsControls.find((control) => control.dataset.settingsKey === key) ?? null;
}

function setPendingSettingsTimeValue(key, seconds) {
  const control = getSettingsControl(key);
  const normalizedValue = formatDuration(clampDuration(seconds));

  pendingSettings[key] = normalizedValue;

  if (control) {
    control.value = normalizedValue;
  }

  syncApplyButton();
}

function setPendingPopupDurationMs(value) {
  const control = getSettingsControl("popupDurationMs");
  const fallbackMs = clampPopupDurationMs(pendingSettings.popupDurationMs) ?? SETTINGS_DEFAULTS.popupDurationMs;
  const normalizedValue = normalizePopupDurationMsInput(value, fallbackMs);

  pendingSettings.popupDurationMs = normalizedValue;

  if (control) {
    control.value = String(normalizedValue);
  }

  syncApplyButton();
}

function syncSettingsUi() {
  settingsControls.forEach((control) => {
    const key = control.dataset.settingsKey;

    if (!(key in pendingSettings)) {
      return;
    }

    if (control.type === "checkbox") {
      control.checked = Boolean(pendingSettings[key]);
      return;
    }

    if (key === "popupDurationMs") {
      control.value = String(
        clampPopupDurationMs(pendingSettings.popupDurationMs) ?? SETTINGS_DEFAULTS.popupDurationMs
      );
      return;
    }

    control.value = pendingSettings[key];
  });
}

function syncAllUiFromPending() {
  syncShortcutUi();
  syncTimePresetButtons();
  syncThresholdUi();
  syncLogFilePathUi();
  syncSettingsUi();
  syncApplyButton();
}

function restoreSettingsDefaults() {
  SETTINGS_TAB_KEYS.forEach((key) => {
    pendingSettings[key] = SETTINGS_DEFAULTS[key];
  });

  syncSettingsUi();
  syncApplyButton();
}

async function applyPendingSettings() {
  finishCapture(true);
  appliedSettings = cloneSettings(pendingSettings);
  timerModel.thresholdSeconds = appliedSettings.thresholdSeconds;
  syncAllUiFromPending();
  syncMainHotkeys();

  if (timerModel.state !== TIMER_STATES.idle) {
    updateTimerState();
  }

  await persistAppliedSettings();
}

function discardPendingChanges() {
  pendingSettings = cloneSettings(appliedSettings);
  finishCapture(true);
  syncAllUiFromPending();
}

async function browseLogFile() {
  try {
    const selectedPath = await window.punch98?.browseLogFile?.();

    if (selectedPath) {
      setPendingLogFilePath(selectedPath);
    }
  } catch (error) {
    console.warn("Unable to choose log file.", error);
  }
}

async function logRenderingInfo() {
  try {
    const renderingInfo = await window.punch98?.getRenderingInfo?.();

    console.log("Punch98 rendering info", {
      devicePixelRatio: window.devicePixelRatio,
      zoomFactor: renderingInfo?.zoomFactor ?? null,
      zoomLevel: renderingInfo?.zoomLevel ?? null
    });
  } catch (error) {
    console.warn("Unable to read rendering info.", error);
  }
}

function syncStatusBar() {
  if (!statusBarField) {
    return;
  }

  if (timerModel.state === TIMER_STATES.idle) {
    statusBarField.textContent = "Idle";
    statusBarField.style.color = "";
    reportTimerStatus();
    return;
  }

  statusBarField.textContent = formatElapsed(timerModel.elapsedSeconds);
  statusBarField.style.color =
    timerModel.state === TIMER_STATES.runningAboveThreshold
      ? STATUS_COLORS.runningAboveThreshold
      : STATUS_COLORS.runningBelowThreshold;
  reportTimerStatus();
}

function stopTimerTicker() {
  if (timerIntervalId !== null) {
    window.clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

function updateTimerState() {
  if (timerModel.state === TIMER_STATES.idle || timerModel.startTimestamp === null) {
    syncStatusBar();
    return;
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timerModel.startTimestamp) / 1000));

  timerModel.elapsedSeconds = elapsedSeconds;
  timerModel.state =
    elapsedSeconds >= timerModel.thresholdSeconds
      ? TIMER_STATES.runningAboveThreshold
      : TIMER_STATES.runningBelowThreshold;

  syncStatusBar();
}

function startTimerTicker() {
  if (timerIntervalId !== null) {
    return;
  }

  timerIntervalId = window.setInterval(() => {
    updateTimerState();
  }, 1000);
}

function resetTimer() {
  stopTimerTicker();
  timerModel.startTimestamp = null;
  timerModel.elapsedSeconds = 0;
  timerModel.thresholdSeconds = appliedSettings.thresholdSeconds;
  timerModel.state = TIMER_STATES.idle;
  syncStatusBar();
}

function startTimer() {
  if (timerModel.state !== TIMER_STATES.idle) {
    showPopupMessage(appliedSettings.timerAlreadyRunning);
    return;
  }


  timerModel.startTimestamp = Date.now();
  timerModel.elapsedSeconds = 0;
  timerModel.thresholdSeconds = appliedSettings.thresholdSeconds;
  timerModel.state = TIMER_STATES.runningBelowThreshold;

  syncStatusBar();
  startTimerTicker();
  updateTimerState();
  showPopupMessage(appliedSettings.timerStarted);
}

async function stopTimer() {
  if (timerModel.state === TIMER_STATES.idle) {
    showPopupMessage(appliedSettings.timerNotRunning);
    return;
  }

  if (isEntryDialogOpen) {
    return;
  }

  updateTimerState();

  const startTimestamp = timerModel.startTimestamp;
  const endTimestamp = Date.now();
  const elapsedSeconds = timerModel.elapsedSeconds;
  const thresholdSeconds = timerModel.thresholdSeconds;

  if (elapsedSeconds < thresholdSeconds) {
    resetTimer();
    showPopupMessage(appliedSettings.thresholdNotReached);
    return;
  }

  stopTimerTicker();
  isEntryDialogOpen = true;
  let entryResult = null;
  let saveResult = null;

  try {
    entryResult = await openEntryDialog({
      startTimestamp,
      endTimestamp,
      durationSeconds: elapsedSeconds
    });

    if (entryResult) {
      saveResult = await saveLogEntry(entryResult);
      console.log("Entry dialog result", entryResult);
    }
  } finally {
    isEntryDialogOpen = false;
    resetTimer();
  }

  if (!entryResult) {
    return;
  }

  if (!saveResult?.ok) {
    showPopupMessage(TEMPORARY_MESSAGES.failedToSaveEntry);
    return;
  }

  if (saveResult.usedDefaultPath && saveResult.createdFile) {
    showPopupMessage(`Log file created: ${saveResult.filePath}`);
    return;
  }

  showPopupMessage(appliedSettings.entrySaved);
}

async function cancelTimer() {
  if (timerModel.state === TIMER_STATES.idle) {
    showPopupMessage(appliedSettings.timerNotRunning);
    return;
  }

  if (isEntryDialogOpen) {
    return;
  }

  updateTimerState();

  const entryResult = {
    startTime: formatEntryTimestamp(timerModel.startTimestamp),
    endTime: formatEntryTimestamp(Date.now()),
    duration: formatElapsed(timerModel.elapsedSeconds),
    text: "",
    canceled: true
  };

  resetTimer();

  const saveResult = await saveLogEntry(entryResult);

  if (!saveResult?.ok) {
    showPopupMessage(TEMPORARY_MESSAGES.failedToSaveEntry);
    return;
  }

  showPopupMessage(appliedSettings.timerCanceled);
}

function setActiveTab(targetName) {
  tabs.forEach((tab) => {
    const link = tab.querySelector("a");
    const isActive = tab.dataset.tabTarget === targetName;

    tab.setAttribute("aria-selected", String(isActive));

    if (link) {
      link.tabIndex = isActive ? 0 : -1;
    }
  });

  if (tabPanel) {
    tabPanel.setAttribute("aria-labelledby", `tab-${targetName}`);
  }

  tabViews.forEach((panel) => {
    const isActive = panel.id === `panel-${targetName}`;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
}

function showShortcutMessage(message) {
  if (!shortcutMessage) {
    console.warn(message);
    return;
  }

  shortcutMessage.textContent = message;
  window.clearTimeout(showShortcutMessage.timeoutId);
  showShortcutMessage.timeoutId = window.setTimeout(() => {
    shortcutMessage.textContent = "";
  }, 2200);
}

function formatShortcut(event) {
  const modifiers = ["Control", "Alt", "Shift", "Meta"];

  if (modifiers.includes(event.key)) {
    return null;
  }

  const parts = [];

  if (event.ctrlKey) {
    parts.push("Ctrl");
  }

  if (event.altKey) {
    parts.push("Alt");
  }

  if (event.shiftKey) {
    parts.push("Shift");
  }

  if (event.metaKey) {
    parts.push("Meta");
  }

  let key = event.key;

  if (key === " ") {
    key = "Space";
  } else if (key.length === 1) {
    key = key.toUpperCase();
  }

  parts.push(key);
  return parts.join("+");
}

function finishCapture(restoreValue = true) {
  if (!captureAction) {
    return;
  }

  const activeButton = shortcutButtons.find((button) => {
    return button.dataset.shortcutAction === captureAction;
  });

  if (activeButton) {
    activeButton.classList.remove("is-capturing");

    if (restoreValue) {
      activeButton.textContent = getShortcutValue(captureAction);
    }
  }

  if (captureCleanup) {
    captureCleanup();
  }

  captureAction = null;
  captureCleanup = null;
}

function beginCapture(action) {
  finishCapture(true);
  captureAction = action;

  const activeButton = shortcutButtons.find((button) => {
    return button.dataset.shortcutAction === action;
  });

  if (!activeButton) {
    captureAction = null;
    return;
  }

  activeButton.classList.add("is-capturing");
  activeButton.textContent = "Press shortcut";
  activeButton.focus();

  const handleKeydown = (event) => {
    if (!captureAction) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (
      event.key === "Escape" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey
    ) {
      finishCapture(true);
      return;
    }

    const formattedShortcut = formatShortcut(event);

    if (!formattedShortcut) {
      return;
    }

    const duplicate = Object.entries(SHORTCUT_KEYS).find(([name, key]) => {
      return name !== captureAction && pendingSettings[key] === formattedShortcut;
    });

    if (duplicate) {
      const duplicateLabel = shortcutLabels[duplicate[0]] || duplicate[0];
      showShortcutMessage(`Shortcut already used by ${duplicateLabel}.`);
      console.warn(`Shortcut already used by ${duplicateLabel}.`);
      finishCapture(true);
      return;
    }

    pendingSettings[SHORTCUT_KEYS[captureAction]] = formattedShortcut;
    finishCapture(false);
    syncShortcutUi();
    syncApplyButton();
  };

  window.addEventListener("keydown", handleKeydown, true);
  captureCleanup = () => {
    window.removeEventListener("keydown", handleKeydown, true);
  };
}

function moveFocus(direction, activeTab) {
  const currentIndex = tabs.indexOf(activeTab);
  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex];
  const nextLink = nextTab.querySelector("a");

  if (nextLink) {
    nextLink.focus();
  }

  setActiveTab(nextTab.dataset.tabTarget);
}

tabs.forEach((tab) => {
  const link = tab.querySelector("a");

  if (!link) {
    return;
  }

  link.addEventListener("click", (event) => {
    event.preventDefault();
    setActiveTab(tab.dataset.tabTarget);
  });

  link.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(-1, tab);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(1, tab);
    }
  });
});

shortcutButtons.forEach((button) => {
  button.addEventListener("click", () => {
    beginCapture(button.dataset.shortcutAction);
  });
});

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setPendingThresholdSeconds(Number(button.dataset.presetSeconds));
  });
});

if (manualThresholdInput) {
  manualThresholdInput.addEventListener("blur", () => {
    commitManualThreshold();
  });

  manualThresholdInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitManualThreshold();
      manualThresholdInput.blur();
    }
  });
}

spinnerButtons.forEach((button) => {
  if (button.classList.contains("settings-spinner-button")) {
    return;
  }

  button.addEventListener("click", () => {
    const delta = button.dataset.spin === "up" ? 60 : -60;
    setPendingThresholdSeconds(pendingSettings.thresholdSeconds + delta);
  });
});

if (logFilePathInput) {
  logFilePathInput.addEventListener("input", (event) => {
    pendingSettings.logFilePath = event.target.value;
    syncApplyButton();
  });
}

if (browseLogFileButton) {
  browseLogFileButton.addEventListener("click", () => {
    browseLogFile();
  });
}

settingsControls.forEach((control) => {
  const key = control.dataset.settingsKey;

  if (control.type === "checkbox") {
    control.addEventListener("change", (event) => {
      pendingSettings[key] = event.target.checked;
      syncApplyButton();
    });
    return;
  }

  if (control.tagName === "SELECT") {
    control.addEventListener("change", (event) => {
      pendingSettings[key] = event.target.value;
      syncApplyButton();
    });
    return;
  }

  if (control.classList.contains("settings-time-input")) {
    control.addEventListener("blur", (event) => {
      const fallbackSeconds = parseDuration(pendingSettings[key]) ?? 300;
      const normalizedSeconds = normalizeDurationInput(event.target.value, fallbackSeconds);
      setPendingSettingsTimeValue(key, normalizedSeconds);
    });

    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.target.blur();
      }
    });

    return;
  }

  if (key === "popupDurationMs") {
    control.addEventListener("blur", (event) => {
      setPendingPopupDurationMs(event.target.value);
    });

    control.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.target.blur();
      }
    });

    return;
  }

  control.addEventListener("input", (event) => {
    pendingSettings[key] = event.target.value;
    syncApplyButton();
  });
});

settingsSpinnerButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.settingsSpinKey;

    if (key === "popupDurationMs") {
      const control = getSettingsControl(key);
      const currentDurationMs =
        clampPopupDurationMs(control?.value ?? "") ??
        clampPopupDurationMs(pendingSettings.popupDurationMs) ??
        SETTINGS_DEFAULTS.popupDurationMs;
      const delta = button.dataset.spin === "up" ? 1 : -1;

      setPendingPopupDurationMs(currentDurationMs + delta);
      return;
    }

    const control = getSettingsControl(key);
    const currentSeconds =
      parseDuration(control?.value ?? "") ?? parseDuration(pendingSettings[key]) ?? 300;
    const delta = button.dataset.spin === "up" ? 60 : -60;

    setPendingSettingsTimeValue(key, currentSeconds + delta);
  });
});

if (restoreSettingsDefaultsButton) {
  restoreSettingsDefaultsButton.addEventListener("click", () => {
    restoreSettingsDefaults();
  });
}

if (applyButton) {
  applyButton.addEventListener("click", async () => {
    await applyPendingSettings();
  });
}

if (okButton) {
  okButton.addEventListener("click", async () => {
    await applyPendingSettings();
    closeWindow();
  });
}

if (cancelButton) {
  cancelButton.addEventListener("click", () => {
    discardPendingChanges();
    closeWindow();
  });
}

if (helpButton) {
  helpButton.addEventListener("click", () => {
    void openHelpLink();
  });
}

if (closeButton) {
  closeButton.addEventListener("click", () => {
    closeWindow();
  });
}

window.addEventListener("beforeunload", () => {
  stopTimerTicker();
  finishCapture(true);
  removeTimerActionListener();
});

async function initializeApp() {
  appliedSettings = await loadAppliedSettings();
  pendingSettings = cloneSettings(appliedSettings);

  syncAllUiFromPending();
  syncMainHotkeys();
  syncStatusBar();
  setActiveTab("shortcuts");

  isSettingsReady = true;
  flushQueuedTimerActions();
  void logRenderingInfo();
}

void initializeApp();















