import { startDeviceFlow, completeDeviceFlow, getStoredAuth, clearStoredAuth } from "../lib/github-auth.js";

const authStatus = document.getElementById("authStatus");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const deviceCodeBox = document.getElementById("deviceCodeBox");
const verificationLink = document.getElementById("verificationLink");
const userCode = document.getElementById("userCode");
const pollStatus = document.getElementById("pollStatus");

const repoOwnerInput = document.getElementById("repoOwner");
const repoNameInput = document.getElementById("repoName");
const deviceNameInput = document.getElementById("deviceName");
const saveBtn = document.getElementById("saveBtn");
const saveStatus = document.getElementById("saveStatus");

function randomDeviceSuffix() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function refreshAuthStatus() {
  const auth = await getStoredAuth();
  if (auth) {
    authStatus.textContent = "Connected to GitHub.";
    authStatus.className = "status-ok";
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
  } else {
    authStatus.textContent = "Not connected.";
    authStatus.className = "status-bad";
    connectBtn.style.display = "inline-block";
    disconnectBtn.style.display = "none";
  }
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  repoOwnerInput.value = settings?.repoOwner || "segfahlt";
  repoNameInput.value = settings?.repoName || "bookmarks";
  deviceNameInput.value = settings?.deviceName || `device-${randomDeviceSuffix()}`;
}

connectBtn.addEventListener("click", async () => {
  connectBtn.disabled = true;
  try {
    const flow = await startDeviceFlow();
    verificationLink.href = flow.verification_uri;
    verificationLink.textContent = flow.verification_uri;
    userCode.textContent = flow.user_code;
    deviceCodeBox.style.display = "block";
    pollStatus.textContent = "Waiting for you to authorize...";

    await completeDeviceFlow(flow.device_code, flow.interval);

    pollStatus.textContent = "Connected!";
    deviceCodeBox.style.display = "none";
    await refreshAuthStatus();
  } catch (err) {
    pollStatus.textContent = `Error: ${err.message}`;
  } finally {
    connectBtn.disabled = false;
  }
});

disconnectBtn.addEventListener("click", async () => {
  await clearStoredAuth();
  await refreshAuthStatus();
});

saveBtn.addEventListener("click", async () => {
  const settings = {
    repoOwner: repoOwnerInput.value.trim(),
    repoName: repoNameInput.value.trim(),
    deviceName: deviceNameInput.value.trim(),
  };
  await chrome.storage.local.set({ settings });
  saveStatus.textContent = "Saved.";
  setTimeout(() => (saveStatus.textContent = ""), 2000);
});

refreshAuthStatus();
loadSettings();
