const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const status = document.getElementById("status");

function updateStatus() {
  chrome.storage.local.get("running", (res) => {
    status.textContent = res.running ? "✅ Automation is ON" : "⛔ Automation is OFF";
  });
}
updateStatus();

startBtn.addEventListener("click", () => {
  chrome.storage.local.set({ running: true }, () => {
    updateStatus();
    // Redirect current tab to overview page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      chrome.tabs.reload(tabs[0].id);
      // chrome.tabs.update(tabs[0].id, { url: "https://www.upwork.com/nx/reports/client/timesheet/" });
    });
  });
});

stopBtn.addEventListener("click", () => {
  chrome.storage.local.set({ running: false }, () => {
    updateStatus();
    // Notify any content script in active tab to stop immediately
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: "stopAutomation" });
    });
  });
});
