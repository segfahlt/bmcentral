import { getStoredAuth } from "../lib/github-auth.js";

const status = document.getElementById("status");
const syncResult = document.getElementById("syncResult");

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

function runSync(type, verb, onResult) {
  syncResult.textContent = `${verb}...`;
  chrome.runtime.sendMessage({ type }, (response) => {
    if (!response) {
      syncResult.textContent = "No response from background script.";
      return;
    }
    if (!response.ok) {
      syncResult.textContent = `Error: ${response.error}`;
      return;
    }
    syncResult.textContent = onResult(response.result);
  });
}

document.getElementById("pushBtn").addEventListener("click", () => {
  runSync("push-now", "Pushing", (r) =>
    r.pushed ? `Pushed: ${r.changed} changed, ${r.removed} removed. PR: ${r.pr}` : `No changes (${r.reason}).`
  );
});

document.getElementById("pullBtn").addEventListener("click", () => {
  const confirmed = confirm(
    "Pull will REPLACE your local bookmarks with whatever is on trunk (main). " +
      "Any local-only bookmarks not yet pushed will be lost. Continue?"
  );
  if (!confirmed) return;
  runSync("pull-now", "Pulling", (r) => `Pulled from trunk: ${r.bookmarksCreated} bookmarks created.`);
});

getStoredAuth().then((auth) => {
  status.textContent = auth ? "Connected to GitHub." : "Not connected.";
});
