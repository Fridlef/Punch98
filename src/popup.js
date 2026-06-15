const popupElement = document.querySelector("#popup");
let activeRequestId = 0;

function reportPopupSize() {
  if (!popupElement || !window.punch98Popup?.reportSize) {
    return;
  }

  window.punch98Popup.reportSize({
    requestId: activeRequestId,
    width: Math.ceil(popupElement.offsetWidth),
    height: Math.ceil(popupElement.offsetHeight)
  });
}

const removeUpdateListener = window.punch98Popup?.onUpdate?.((payload) => {
  if (!popupElement) {
    return;
  }

  activeRequestId = Number(payload?.requestId) || 0;
  popupElement.textContent = payload?.message || "";
  reportPopupSize();
}) ?? (() => {});

window.addEventListener("beforeunload", () => {
  removeUpdateListener();
});

