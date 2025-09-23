chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "download") {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename,
      conflictAction: "uniquify"
    });
  }
});
