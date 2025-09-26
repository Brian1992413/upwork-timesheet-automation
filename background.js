// Background service worker: manages stored timesheet links, navigation, downloads.
let timesheetLinks = [];
let currentIndex = 0;

console.log("🟢 background ready");

// Helper to persist to storage
function persistLinks() {
  chrome.storage.local.set({ timesheetLinks, currentIndex });
}

// When content sends timesheet links, store & open first
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === "storeTimesheetLinks") {
    timesheetLinks = Array.isArray(msg.links) ? msg.links : [];
    currentIndex = 0;
    persistLinks();
    console.log(`💾 Stored ${timesheetLinks.length} timesheet links`);

    // open first link in the sender tab (overview tab)
    if (timesheetLinks.length > 0 && sender && sender.tab && sender.tab.id) {
      chrome.tabs.update(sender.tab.id, { url: timesheetLinks[0] });
    }
    return;
  }

  if (msg.action === "finishedCollecting") {
    // move to next
    currentIndex++;
    persistLinks();
    chrome.storage.local.get("running", (res) => {
      const isRunning = !!res.running;
      if (!isRunning) {
        console.log("⛔ Running flag false; stopping navigation");
        return;
      }
      if (currentIndex < timesheetLinks.length) {
        console.log(`➡️ Going to link ${currentIndex + 1}/${timesheetLinks.length}`);
        // use sender.tab to update the same tab
        if (sender && sender.tab && sender.tab.id) {
          chrome.tabs.update(sender.tab.id, { url: timesheetLinks[currentIndex] });
        } else {
          // fallback: query active tab
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0]) chrome.tabs.update(tabs[0].id, { url: timesheetLinks[currentIndex] });
          });
        }
      } else {
        console.log("🎉 All timesheet links processed");
        chrome.storage.local.set({ running: false });
      }
    });
    return;
  }

  if (msg.action === "downloadImage") {
    const { url, filename } = msg;
    if (!url || !filename) {
      console.warn("downloadImage missing url/filename");
      return;
    }
    chrome.downloads.download({
      url,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn("Download failed:", chrome.runtime.lastError.message);
      } else {
        console.log(`⬇️ Download started (${downloadId}): ${filename}`);
      }
    });
    return;
  }

  if (msg.action === "stopAutomation") {
    chrome.storage.local.set({ running: false }, () => {
      console.log("⛔ Automation stopped (background)");
    });
    // also clear in-memory
    timesheetLinks = [];
    currentIndex = 0;
    return;
  }
});
