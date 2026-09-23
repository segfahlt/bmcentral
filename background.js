import { push } from "./src/lib/sync.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("bmcentral installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "sync-now") {
    push()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }
});
