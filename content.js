// Content script: runs in Upwork pages (overview & workroom) — scrapes and operates modal UI.
console.log("✅ Content script injected");

// Promise wrapper for chrome.storage.local.get/set
function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Add jitter (human-like variation)
async function humanWait(baseMs = 1000, varianceMs = 500) {
  const delay = baseMs + Math.floor(Math.random() * varianceMs);
  console.log(`⏳ Waiting ${delay}ms`);
  await sleep(delay);
}
async function updateRangeParam() {
  const currentUrl = new URL(window.location.href);
  if (!currentUrl.pathname.includes("/nx/reports/client/timesheet")) return;

  const st2 = await storageGet(["running"]);
  if (!st2.running) return;

  if (window.__timesheetRangeUpdated) return; // only once per page load

  const today = new Date();
  const lastYear = new Date();
  lastYear.setFullYear(today.getFullYear() - 1);

  const newRange = `${formatDate(lastYear)}-${formatDate(today)}`;
  const params = currentUrl.searchParams;

  if (params.get("range") === newRange) {
    console.log("✅ Timesheet range already correct");
    window.__timesheetRangeUpdated = true;
    return; // no redirect needed
  }

  params.set("range", newRange);
  const newUrl = `${currentUrl.origin}${
    currentUrl.pathname
  }?${params.toString()}`;
  console.log("🔄 Updating range — redirecting to:", newUrl);

  // Prevent infinite reload loop
  window.__timesheetRangeUpdated = true;

  // Redirect — script stops here; overview processing runs on reload
  window.location.href = newUrl;
}

// Utility to format date as YYYY-MM-DD
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// Wait until element exists (simple poll)
function waitFor(selector, maxMs = 15000, interval = 250) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - start >= maxMs)
        return reject(new Error(`Timeout waiting for ${selector}`));
      setTimeout(check, interval);
    })();
  });
}

// Wait until at least one element matching selector exists
function waitForAll(selector, maxMs = 15000, interval = 300) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      const nodes = document.querySelectorAll(selector);
      if (nodes && nodes.length > 0) return resolve(Array.from(nodes));
      if (Date.now() - start >= maxMs)
        return reject(new Error(`Timeout waiting for ${selector}`));
      setTimeout(check, interval);
    })();
  });
}

// Sanitize filename
function sanitize(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-\.]/g, "-")
    .slice(0, 200);
}

// Extract date/time/index from modal header
function parseModalHeader(headerEl) {
  const obj = { date: null, time: null, index: null };
  if (!headerEl) return obj;
  // date often in a .text-color-graphite element
  const dateNode = headerEl.querySelector(".text-color-graphite");
  if (dateNode) {
    const raw = dateNode.textContent.trim();
    const d = new Date(raw);
    if (!isNaN(d)) {
      obj.date = d.toISOString().slice(0, 10); // YYYY-MM-DD
    }
  }
  const h5 = headerEl.querySelector("h5");
  if (h5) {
    const tMatch = h5.textContent.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
    if (tMatch) obj.time = tMatch[1].toUpperCase();
  }

  const token = headerEl.querySelector(".air3-token");
  if (token) {
    const idx = token.textContent.match(/\d+/);
    if (idx) obj.index = idx[0];
  }
  return obj;
}

// Notify background that links are available
function sendStoreLinks(links) {
  chrome.runtime.sendMessage({ action: "storeTimesheetLinks", links });
}

// Notify background that this workroom finished
function notifyFinishedCollecting() {
  chrome.runtime.sendMessage({ action: "finishedCollecting" });
}

// Send download request to background
function requestDownload(url, filename) {
  chrome.runtime.sendMessage({ action: "downloadImage", url, filename });
}

// Listen for Stop from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "stopAutomation") {
    // nothing else needed — background will stop navigation, but set a local flag if needed
    console.log("⛔ Received stopAutomation in content script");
  }
});

// --- Overview page: collect timesheet links & send to background ---
async function processOverviewPage() {
  try {
    // ensure automation is enabled
    const st = await storageGet(["running"]);
    if (!st.running) {
      console.log("⛔ Not running — skipping overview processing");
      return;
    }

    // Wait until table anchors appear
    const anchors = await waitForAll(
      "td.column-id-hours a.up-n-link",
      15000,
      500
    ).catch(() => document.querySelectorAll("td.column-id-hours a"));

    const links = Array.from(anchors || [])
      .map((a) => a.href) // anchor.href gives absolute URL
      .filter((h) => h && h.includes("/nx/wm/workroom/"));

    if (links.length === 0) {
      console.warn("⚠️ No timesheet links found on overview page");
      return;
    }

    console.log(`📋 Collected ${links.length} timesheet links`);
    await humanWait(2000, 1500);
    // persist in storage & hand list to background manager
    await storageSet({ timesheetLinks: links, currentIndex: 0 });
    sendStoreLinks(links);
    // background will navigate to the first link
  } catch (err) {
    console.warn("Overview processing error:", err.message || err);
  }
}
async function waitForScreenshotButton(timeout = 20000, interval = 500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const candidates = Array.from(
      document.querySelectorAll("button.screenshot-button")
    );
    const valid = candidates.find((btn) => {
      const img = btn.querySelector("img.wd-snapshot-img");
      return img && img.offsetParent !== null; // means it's visible
    });
    if (valid) return valid;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
async function waitForModalNavButton(timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // look inside modal footer
    const footer = document.querySelector(".air3-modal-footer");
    if (footer) {
      // Look for visible Next or Close button
      const buttons = Array.from(footer.querySelectorAll("button.air3-btn"));
      const nextBtn = buttons.find(
        (b) => b.textContent.trim().includes("Next") && b.offsetParent !== null
      );
      if (nextBtn) return { type: "next", el: nextBtn };

      const closeBtn = buttons.find(
        (b) => b.textContent.trim().includes("Close") && b.offsetParent !== null
      );
      if (closeBtn) return { type: "close", el: closeBtn };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
// Get work diary date from URL
function getWorkDiaryDateFromUrl() {
  const url = new URL(window.location.href);
  const wd = url.searchParams.get("workdiaryDate"); // e.g. 2024-10-03
  if (!wd) return new Date().toISOString().slice(0, 10).replace(/-/g, ""); // fallback
  return wd.replace(/-/g, ""); // 20241003
}
// --- Workroom page: open first screenshot modal, download images, handle Next/Close ---
async function processWorkroomPage() {
  try {
    // ensure automation flag is on
    const st = await storageGet(["running"]);
    if (!st.running) {
      console.log("⛔ Not running — skipping workroom processing");
      return;
    }

    // Find and click the correct screenshot button
    const btn = await waitForScreenshotButton();
    if (!btn) {
      console.warn("⚠️ No valid screenshot button found in workroom");
      notifyFinishedCollecting();
      return;
    }
    console.log("✅ Clicking screenshot button:", btn);
    await humanWait(1200, 800);
    btn.click();

    // Now process modal images (First image + Next loop)
    let keepLoop = true;
    while (keepLoop) {
      // ensure running flag still true
      const st2 = await storageGet(["running"]);
      if (!st2.running) {
        console.log("⛔ Running turned off during modal loop");
        return;
      }

      // Wait for modal contents
      const modal = await waitFor("div.air3-modal", 10000).catch(() => null);
      if (!modal) {
        console.warn("⚠️ Modal did not appear");
        notifyFinishedCollecting();
        return;
      }

      // Wait for image and header and memo
      await waitFor("img.wd-snapshot-img", 10000).catch(() => null);
      const imgEl = modal.querySelector("img.wd-snapshot-img");
      const memoEl = modal.querySelector("div.mb-4x p");
      const headerEl = modal.querySelector("div.air3-modal-header");

      const imageUrl = imgEl ? imgEl.src : null;
      const memoText = memoEl ? memoEl.textContent.trim() : "NoMemo";
      const parsed = parseModalHeader(headerEl);
      const datePart = getWorkDiaryDateFromUrl();
      const timePart = parsed.time || "0000";
      const idxPart = parsed.index || "1";
      const filename = sanitize(
        `${datePart}_${timePart}_${memoText}_${idxPart}.jpg`
      );
      if (imageUrl) {
        await humanWait(800, 600);
        requestDownload(imageUrl, filename);
      } else {
        console.warn("⚠️ No image URL found in modal");
      }

      // Decide whether to click Next or Close
      // After downloading the image from modal
      const nav = await waitForModalNavButton();
      if (!nav) {
        console.warn(
          "⚠️ No Next/Close button found in modal, ending collection"
        );
        notifyFinishedCollecting();
        return;
      }
      if (nav.type === "next") {
        // click Next and loop to next image in modal
        await humanWait(1500, 1200);
        nav.el.click();
        await new Promise((r) => setTimeout(r, 800)); // small wait for modal to update
        // loop continues
      } else {
        console.log("❌ Clicking Close button, finished collecting screenshots");
        await humanWait(1000, 700);
        nav.el.click();
        notifyFinishedCollecting();

        // give UI time to close
        await new Promise((r) => setTimeout(r, 700));
        // notify background to move to next workroom link
        notifyFinishedCollecting();
        keepLoop = false;
      }
    } // end modal loop
  } catch (err) {
    console.warn("Workroom processing error:", err.message || err);
    // attempt to notify background to continue
    try {
      notifyFinishedCollecting();
    } catch (e) {}
  }
}

// --- Router: run contextually ---
(async function router() {
  try {
    const st = await storageGet(["running"]);
    if (!st.running) {
      console.log("⛔ Automation not enabled; nothing to do on this page.");
      return;
    }
    const url = new URL(window.location.href);
    
    if (url.pathname.includes("/nx/reports/client/timesheet")) {
/*
      // 1️⃣ Check if range param is already correct
      const today = new Date();
      const lastYear = new Date();
      lastYear.setFullYear(today.getFullYear() - 1);
      const correctRange = `${formatDate(lastYear)}-${formatDate(today)}`;

      if (url.searchParams.get("range") !== correctRange) {
        // Redirect to correct range
        const newUrl = `${url.origin}${url.pathname}?range=${correctRange}`;
        console.log("🔄 Updating range — redirecting to:", newUrl);
        window.__timesheetRangeUpdated = true;
        window.location.href = newUrl;
        return; // stop script here; will run again on reload
      }

      console.log("✅ Timesheet range correct — processing overview page");
*/
      await processOverviewPage(); // run after page has correct range
    } else if (url.pathname.includes("/nx/wm/workroom/")) {
      console.log("📂 Workroom detected — processing screenshots");
      await processWorkroomPage();
    } else {
      console.log("ℹ️ Not a target page:", url.href);
    }
  } catch (err) {
    console.warn("Router error:", err);
  }
})();

