import { getStoredAuth } from "../lib/github-auth.js";

const status = document.getElementById("status");
const statusDot = document.getElementById("statusDot");
const syncResult = document.getElementById("syncResult");
const buttons = ["pushBtn", "pullBtn", "backupBtn", "restoreBtn"].map((id) => document.getElementById(id));

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

function setButtonsDisabled(disabled) {
  for (const btn of buttons) btn.disabled = disabled;
}

function runSync(type, verb, onResult) {
  setButtonsDisabled(true);
  syncResult.textContent = `${verb}...`;
  chrome.runtime.sendMessage({ type }, (response) => {
    setButtonsDisabled(false);
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
    "Pull will REPLACE your local bookmarks with whatever is on trunk (the repo's default branch). " +
      "A backup of your current bookmarks will be taken first automatically. Continue?"
  );
  if (!confirmed) return;
  runSync(
    "pull-now",
    "Pulling",
    (r) => `Pulled from trunk: ${r.bookmarksCreated} bookmarks created. Backup: ${r.backupCommit.slice(0, 7)}`
  );
});

document.getElementById("backupBtn").addEventListener("click", () => {
  runSync("backup-now", "Backing up", (r) => `Backed up to ${r.branch} (${r.commit.slice(0, 7)}).`);
});

document.getElementById("restoreBtn").addEventListener("click", () => {
  const confirmed = confirm(
    "Restore will REPLACE your local bookmarks with the last backup taken on this device. Continue?"
  );
  if (!confirmed) return;
  runSync("restore-backup-now", "Restoring", (r) => `Restored: ${r.bookmarksCreated} bookmarks created.`);
});

getStoredAuth().then((auth) => {
  status.textContent = auth ? "Connected to GitHub." : "Not connected.";
  statusDot.classList.toggle("eb-online", Boolean(auth));
});
