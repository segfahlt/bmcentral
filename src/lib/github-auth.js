// GitHub App Device Flow auth. No client secret involved by design — see
// design discussion: device flow is a public-client grant (RFC 8628).

const CLIENT_ID = "Iv23lii811rw6ITHNWkg";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

export async function startDeviceFlow() {
  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!res.ok) throw new Error(`Device code request failed: ${res.status}`);
  return res.json(); // { device_code, user_code, verification_uri, expires_in, interval }
}

async function requestToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, ...body }),
  });
  return res.json();
}

// Caller polls this on the interval GitHub returns from startDeviceFlow(),
// backing off by 5s whenever it gets "slow_down".
export function pollOnce(deviceCode) {
  return requestToken({
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
}

function refreshWith(refreshTokenValue) {
  return requestToken({
    grant_type: "refresh_token",
    refresh_token: refreshTokenValue,
  });
}

async function saveTokens(tokenResponse) {
  const now = Date.now();
  const auth = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    accessTokenExpiresAt: now + tokenResponse.expires_in * 1000,
    refreshTokenExpiresAt: now + tokenResponse.refresh_token_expires_in * 1000,
  };
  await chrome.storage.local.set({ githubAuth: auth });
  return auth;
}

export async function completeDeviceFlow(deviceCode, intervalSeconds) {
  let interval = intervalSeconds;
  // GitHub's expires_in for the device code is typically 900s; give a generous cap.
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const result = await pollOnce(deviceCode);
    if (result.access_token) {
      return saveTokens(result);
    }
    if (result.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (result.error === "authorization_pending") {
      continue;
    }
    // expired_token, access_denied, or anything else is fatal.
    throw new Error(`Device flow failed: ${result.error || "unknown error"}`);
  }
  throw new Error("Device flow timed out waiting for authorization");
}

export async function getStoredAuth() {
  const { githubAuth } = await chrome.storage.local.get("githubAuth");
  return githubAuth || null;
}

export async function clearStoredAuth() {
  await chrome.storage.local.remove("githubAuth");
}

// Returns a valid access token, transparently refreshing if it's near expiry.
export async function getValidAccessToken() {
  const auth = await getStoredAuth();
  if (!auth) return null;

  if (Date.now() < auth.accessTokenExpiresAt - 60_000) {
    return auth.accessToken;
  }

  if (Date.now() > auth.refreshTokenExpiresAt) {
    await clearStoredAuth();
    throw new Error("Refresh token expired — reconnect to GitHub in options");
  }

  const refreshed = await refreshWith(auth.refreshToken);
  if (refreshed.error) {
    throw new Error(`Token refresh failed: ${refreshed.error}`);
  }
  const saved = await saveTokens(refreshed);
  return saved.accessToken;
}
