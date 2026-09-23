import { getStoredAuth } from "../lib/github-auth.js";

const status = document.getElementById("status");
document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

getStoredAuth().then((auth) => {
  status.textContent = auth ? "Connected to GitHub." : "Not connected.";
});
