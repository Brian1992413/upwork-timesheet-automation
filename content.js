(async () => {
  // Step 1: Grab all links to contracts/days
  const contractLinks = [...document.querySelectorAll("a[href*='timesheet']")];

  for (let i = 0; i < contractLinks.length; i++) {
    const link = contractLinks[i].href;

    // Load each timesheet page in background
    const res = await fetch(link, { credentials: "include" });
    const html = await res.text();

    // Create temporary DOM parser
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Extract date, memo, and images
    const date = doc.querySelector("h2,h3")?.innerText.trim() || "unknown";
    const screenshots = doc.querySelectorAll("img");

    screenshots.forEach((img, idx) => {
      const src = img.src;
      const memo = img.closest("div")?.innerText.split("\n")[0] || "nomemo";
      const safeMemo = memo.replace(/\s+/g, "_").slice(0, 30); // shorten

      const filename = `${date}_${safeMemo}_${idx}.jpg`;

      chrome.runtime.sendMessage({
        action: "download",
        url: src,
        filename
      });
    });
  }
})();
