// Push: diff the live bookmark tree against the last-known-pushed snapshot,
// commit the diff to this device's branch (rebased onto current trunk),
// open or update a PR against main. Never writes to main directly.
//
// Pull (chrome tree <- trunk) is not implemented yet.

import { getValidAccessToken } from "./github-auth.js";
import { buildDesiredFileMap } from "./bookmark-tree.js";
import * as gh from "./github-api.js";

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings?.repoOwner || !settings?.repoName || !settings?.deviceName) {
    throw new Error("Settings incomplete — set repo owner/name/device name in options");
  }
  return settings;
}

async function getShadow() {
  const { syncShadow } = await chrome.storage.local.get("syncShadow");
  return syncShadow || { files: {}, trunkSha: null };
}

async function saveShadow(shadow) {
  await chrome.storage.local.set({ syncShadow: shadow });
}

function diffMaps(desired, previousFiles) {
  const changed = [];
  const removed = [];
  for (const [path, content] of desired) {
    if (previousFiles[path] !== content) changed.push([path, content]);
  }
  for (const path of Object.keys(previousFiles)) {
    if (!desired.has(path)) removed.push(path);
  }
  return { changed, removed };
}

export async function push() {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to GitHub");
  const { repoOwner, repoName, deviceName } = await getSettings();

  const desiredMap = await buildDesiredFileMap();
  const shadow = await getShadow();
  const { changed, removed } = diffMaps(desiredMap, shadow.files);

  if (changed.length === 0 && removed.length === 0) {
    return { pushed: false, reason: "no changes" };
  }

  const mainRef = await gh.getRef(token, repoOwner, repoName, "heads/main");
  if (!mainRef) {
    throw new Error(
      `${repoOwner}/${repoName} has no 'main' branch yet — push an initial commit manually first, ` +
        `so the extension always syncs through a reviewable PR, even for the first import.`
    );
  }
  const trunkCommitSha = mainRef.object.sha;
  const trunkCommit = await gh.getCommit(token, repoOwner, repoName, trunkCommitSha);
  const trunkTreeSha = trunkCommit.tree.sha;

  const treeEntries = [];
  for (const [path, content] of changed) {
    const blobSha = await gh.createBlob(token, repoOwner, repoName, content);
    treeEntries.push({ path, mode: "100644", type: "blob", sha: blobSha });
  }
  for (const path of removed) {
    treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
  }

  const newTreeSha = await gh.createTree(token, repoOwner, repoName, trunkTreeSha, treeEntries);
  const commitMessage = `Sync from ${deviceName}: ${changed.length} changed, ${removed.length} removed`;
  const newCommitSha = await gh.createCommit(token, repoOwner, repoName, commitMessage, newTreeSha, trunkCommitSha);

  const branchName = `sync/${deviceName}`;
  const branchRef = `heads/${branchName}`;
  const existingBranch = await gh.getRef(token, repoOwner, repoName, branchRef);
  if (existingBranch) {
    await gh.updateRef(token, repoOwner, repoName, branchRef, newCommitSha, true);
  } else {
    await gh.createRef(token, repoOwner, repoName, `refs/${branchRef}`, newCommitSha);
  }

  let pr = await gh.findOpenPull(token, repoOwner, repoName, branchName, "main");
  if (!pr) {
    pr = await gh.createPull(
      token,
      repoOwner,
      repoName,
      `Sync from ${deviceName}`,
      branchName,
      "main",
      `Automated bookmark sync from device "${deviceName}".\n\n${changed.length} file(s) changed, ${removed.length} removed.`
    );
  }

  const newShadowFiles = { ...shadow.files };
  for (const [path, content] of changed) newShadowFiles[path] = content;
  for (const path of removed) delete newShadowFiles[path];
  await saveShadow({ files: newShadowFiles, trunkSha: trunkCommitSha });

  return { pushed: true, changed: changed.length, removed: removed.length, pr: pr.html_url };
}
