// Thin wrapper over GitHub REST + Git Data API. Called directly from the
// extension's background service worker — no server in between by design.

const API = "https://api.github.com";

async function ghFetch(path, token, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (res.status === 404 && options.allow404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${options.method || "GET"} ${path} failed: ${res.status} ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function getRepo(token, owner, repo) {
  return ghFetch(`/repos/${owner}/${repo}`, token);
}

export function getRef(token, owner, repo, ref) {
  return ghFetch(`/repos/${owner}/${repo}/git/ref/${ref}`, token, { allow404: true });
}

export function getCommit(token, owner, repo, sha) {
  return ghFetch(`/repos/${owner}/${repo}/git/commits/${sha}`, token);
}

export function getTreeRecursive(token, owner, repo, treeSha) {
  return ghFetch(`/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, token);
}

function decodeBase64Utf8(base64) {
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

export async function getBlob(token, owner, repo, sha) {
  const res = await ghFetch(`/repos/${owner}/${repo}/git/blobs/${sha}`, token);
  return decodeBase64Utf8(res.content);
}

export async function createBlob(token, owner, repo, content) {
  const res = await ghFetch(`/repos/${owner}/${repo}/git/blobs`, token, {
    method: "POST",
    body: JSON.stringify({ content, encoding: "utf-8" }),
  });
  return res.sha;
}

export async function createTree(token, owner, repo, baseTreeSha, entries) {
  const res = await ghFetch(`/repos/${owner}/${repo}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  });
  return res.sha;
}

export async function createCommit(token, owner, repo, message, treeSha, parentSha) {
  const res = await ghFetch(`/repos/${owner}/${repo}/git/commits`, token, {
    method: "POST",
    body: JSON.stringify({ message, tree: treeSha, parents: parentSha ? [parentSha] : [] }),
  });
  return res.sha;
}

export function updateRef(token, owner, repo, ref, sha, force = true) {
  return ghFetch(`/repos/${owner}/${repo}/git/refs/${ref}`, token, {
    method: "PATCH",
    body: JSON.stringify({ sha, force }),
  });
}

export function createRef(token, owner, repo, ref, sha) {
  return ghFetch(`/repos/${owner}/${repo}/git/refs`, token, {
    method: "POST",
    body: JSON.stringify({ ref, sha }),
  });
}

export async function findOpenPull(token, owner, repo, head, base) {
  const res = await ghFetch(`/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${head}&base=${base}`, token);
  return res[0] || null;
}

export function createPull(token, owner, repo, title, head, base, body) {
  return ghFetch(`/repos/${owner}/${repo}/pulls`, token, {
    method: "POST",
    body: JSON.stringify({ title, head, base, body }),
  });
}
