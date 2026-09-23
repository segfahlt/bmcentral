// Sync engine (bookmark diffing, GitHub commit/PR logic) lands here next.
// For now: just confirm the service worker boots.
chrome.runtime.onInstalled.addListener(() => {
  console.log("bmcentral installed");
});
