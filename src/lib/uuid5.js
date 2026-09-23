// Deterministic bookmark IDs: uuid5(NAMESPACE_URL, normalizedUrl).
// Matches the scheme used by the one-off Python importer that seeded the repo.

export const NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8"; // RFC 4122 predefined namespace

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToUuid(bytes) {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function normalizeUrl(url) {
  url = url.trim();
  if (url.endsWith("/") && (url.match(/\//g) || []).length === 3) {
    // bare origin, e.g. https://example.com/ -> https://example.com
    url = url.slice(0, -1);
  }
  return url;
}

export async function uuid5(name, namespaceUuid) {
  const namespaceBytes = uuidToBytes(namespaceUuid);
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(namespaceBytes.length + nameBytes.length);
  data.set(namespaceBytes);
  data.set(nameBytes, namespaceBytes.length);

  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hash = new Uint8Array(hashBuffer).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(hash);
}

export async function bookmarkId(url) {
  return uuid5(normalizeUrl(url), NAMESPACE_URL);
}
