import { getStoredAuth } from "../lib/github-auth.js";

const status = document.getElementById("status");
const syncResult = document.getElementById("syncResult");

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("syncNow").addEventListener("click", () => {
  syncResult.textContent = "Syncing...";
  chrome.runtime.sendMessage({ type: "sync-now" }, (response) => {
    if (!response) {
      syncResult.textContent = "No response from background script.";
      return;
    }
    if (!response.ok) {
      syncResult.textContent = `Error: ${response.error}`;
      return;
    }
    const r = response.result;
    syncResult.textContent = r.pushed
      ? `Pushed: ${r.changed} changed, ${r.removed} removed. PR: ${r.pr}`
      : `No changes (${r.reason}).`;
  });
});

getStoredAuth().then((auth) => {
  status.textContent = auth ? "Connected to GitHub." : "Not connected.";
});
