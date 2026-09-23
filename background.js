import { push, pull, backupNow, restoreLastBackup } from "./src/lib/sync.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("bmcentral installed");
});

// In-memory only — resets if the service worker restarts, which is fine:
// a restart means nothing is actually running anymore either. Shared
// across push/pull/backup/restore so none of them can race each other.
let syncInFlight = false;

function runSync(operation, sendResponse) {
  if (syncInFlight) {
    sendResponse({ ok: false, error: "A sync is already in progress — wait for it to finish." });
    return;
  }
  syncInFlight = true;
  operation()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => {
      console.error(err);
      sendResponse({ ok: false, error: err.message });
    })
    .finally(() => {
      syncInFlight = false;
    });
}

const HANDLERS = {
  "push-now": push,
  "pull-now": pull,
  "backup-now": backupNow,
  "restore-backup-now": restoreLastBackup,
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const operation = HANDLERS[message?.type];
  if (!operation) return;
  runSync(operation, sendResponse);
  return true; // keep the message channel open for the async response
});
