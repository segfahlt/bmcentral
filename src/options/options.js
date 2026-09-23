import { startDeviceFlow, completeDeviceFlow, getStoredAuth, clearStoredAuth, getValidAccessToken } from "../lib/github-auth.js";
import { listBranches } from "../lib/github-api.js";

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
const existingDevicesList = document.getElementById("existingDevices");
const refreshDevicesBtn = document.getElementById("refreshDevices");

function randomDeviceSuffix(length = 4) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

function detectOSName() {
  const platform = navigator.platform || "";
  if (platform.startsWith("Win")) return "windows";
  if (platform.startsWith("Mac")) return "mac";
  if (platform.startsWith("Linux")) return "linux";
  return "device";
}

async function detectBrowserName() {
  if (navigator.brave) {
    const isBrave = await navigator.brave.isBrave().catch(() => false);
    if (isBrave) return "brave";
  }
  return "browser";
}

// Not a stable machine identifier — browser extensions can't read the OS
// hostname (a deliberate anti-fingerprinting restriction) — just a more
// recognizable default than plain random hex, so it's easier to tell "this
// was probably me" when reclaiming an identity after a reinstall.
async function suggestDeviceName() {
  const os = detectOSName();
  const browser = await detectBrowserName();
  return `${os}-${browser}-${randomDeviceSuffix()}`;
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
  deviceNameInput.value = settings?.deviceName || (await suggestDeviceName());
}

function extractDeviceNames(branches) {
  const names = new Set();
  for (const branch of branches) {
    const match = branch.name.match(/^(?:sync|backups)\/(.+)$/);
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

async function refreshExistingDevices() {
  existingDevicesList.innerHTML = '<li class="muted">Loading...</li>';
  try {
    const token = await getValidAccessToken();
    if (!token) throw new Error("Connect to GitHub first");
    const repoOwner = repoOwnerInput.value.trim();
    const repoName = repoNameInput.value.trim();
    if (!repoOwner || !repoName) throw new Error("Set repo owner/name first");

    const branches = await listBranches(token, repoOwner, repoName);
    const names = extractDeviceNames(branches);

    if (names.length === 0) {
      existingDevicesList.innerHTML = '<li class="muted">None found.</li>';
      return;
    }

    existingDevicesList.innerHTML = "";
    for (const name of names) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = name;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        deviceNameInput.value = name;
      });
      li.appendChild(link);
      existingDevicesList.appendChild(li);
    }
  } catch (err) {
    existingDevicesList.innerHTML = `<li class="muted">${err.message}</li>`;
  }
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
    await refreshExistingDevices();
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

function sendSyncMessage(type) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type }, (response) => {
      resolve(response || { ok: false, error: "No response from background script." });
    });
  });
}

saveBtn.addEventListener("click", async () => {
  const settings = {
    repoOwner: repoOwnerInput.value.trim(),
    repoName: repoNameInput.value.trim(),
    deviceName: deviceNameInput.value.trim(),
  };
  await chrome.storage.local.set({ settings });

  saveBtn.disabled = true;
  saveStatus.textContent = "Saved. Backing up and pushing...";

  const backupResult = await sendSyncMessage("backup-now");
  const pushResult = await sendSyncMessage("push-now");

  const backupText = backupResult.ok
    ? `backup: ${backupResult.result.branch}`
    : `backup failed: ${backupResult.error}`;
  const pushText = pushResult.ok
    ? pushResult.result.pushed
      ? `push: PR opened at ${pushResult.result.pr}`
      : "push: no changes"
    : `push failed: ${pushResult.error}`;

  saveStatus.textContent = `Saved. ${backupText} | ${pushText}`;
  saveBtn.disabled = false;
  await refreshExistingDevices();
});

refreshDevicesBtn.addEventListener("click", refreshExistingDevices);

refreshAuthStatus();
loadSettings().then(() => refreshExistingDevices());
