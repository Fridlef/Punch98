const form = document.querySelector("#entry-form");
const titleElement = document.querySelector("#entry-dialog-title");
const durationElement = document.querySelector("#entry-duration");
const textArea = document.querySelector("#entry-text");
const okButton = document.querySelector("#entry-ok-button");
const cancelButton = document.querySelector("#entry-cancel-button");
const closeButton = document.querySelector("#entry-close-button");

let hasSubmitted = false;

function submitDialog(canceled) {
  if (hasSubmitted || !window.punch98EntryDialog?.submit) {
    return;
  }

  hasSubmitted = true;
  window.punch98EntryDialog.submit({
    text: textArea?.value ?? "",
    canceled: Boolean(canceled)
  });
}

const removeInitListener = window.punch98EntryDialog?.onInit?.((payload) => {
  hasSubmitted = false;
  document.title = payload?.title || "Punch98 note";

  if (titleElement) {
    titleElement.textContent = payload?.title || "Punch98 note";
  }

  if (durationElement) {
    durationElement.textContent = payload?.elapsedText || "00:00:00";
  }

  if (textArea) {
    textArea.value = "";
    textArea.focus();
  }
}) ?? (() => {});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitDialog(false);
});

okButton?.addEventListener("click", () => {
  submitDialog(false);
});

cancelButton?.addEventListener("click", () => {
  submitDialog(true);
});

closeButton?.addEventListener("click", () => {
  submitDialog(true);
});

textArea?.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    submitDialog(false);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    submitDialog(true);
  }
});

window.addEventListener("beforeunload", () => {
  removeInitListener();
});

