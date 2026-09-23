import { push, pull } from "./src/lib/sync.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("bmcentral installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "push-now") {
    push()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }
  if (message?.type === "pull-now") {
    pull()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
