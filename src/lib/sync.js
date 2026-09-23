// Push: diff the live bookmark tree against the last-known-pushed snapshot,
// commit the diff to this device's branch (rebased onto current trunk),
// open or update a PR against main. Never writes to main directly.
//
// Pull: full wipe-and-rebuild of the local bookmark tree from trunk. Trunk
// is truth — this intentionally does not try to merge, so it only scopes
// its wipe to root folders trunk actually has data for (a root trunk has
// never seen is left completely untouched, not emptied).

import { getValidAccessToken } from "./github-auth.js";
import { buildDesiredFileMap, ROOT_FOLDER_NAMES } from "./bookmark-tree.js";
import * as gh from "./github-api.js";

const REVERSE_ROOT_FOLDER_NAMES = Object.fromEntries(
  Object.entries(ROOT_FOLDER_NAMES).map(([id, name]) => [name, id])
);

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings?.repoOwner || !settings?.repoName) {
    throw new Error("Settings incomplete — set repo owner/name in options");
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
  const settings = await getSettings();
  const { repoOwner, repoName, deviceName } = settings;
  if (!deviceName) throw new Error("Set a device name in options before pushing");

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

// Bounded-concurrency map, so pulling a large trunk doesn't fire hundreds of
// simultaneous blob fetches and trip GitHub's secondary rate limiting.
function mapWithConcurrency(items, limit, fn) {
  return new Promise((resolve, reject) => {
    let nextIndex = 0;
    let activeCount = 0;
    let completedCount = 0;
    const results = new Array(items.length);
    let rejected = false;

    function launchNext() {
      if (rejected) return;
      if (completedCount === items.length) {
        resolve(results);
        return;
      }
      while (activeCount < limit && nextIndex < items.length) {
        const index = nextIndex++;
        activeCount++;
        fn(items[index], index)
          .then((result) => {
            results[index] = result;
            activeCount--;
            completedCount++;
            launchNext();
          })
          .catch((err) => {
            rejected = true;
            reject(err);
          });
      }
    }
    launchNext();
  });
}

function ensureFolderNode(map, path) {
  if (!map.has(path)) map.set(path, { order: [], bookmarks: new Map() });
  return map.get(path);
}

async function fetchTrunkFileMap(token, owner, repo) {
  const mainRef = await gh.getRef(token, owner, repo, "heads/main");
  if (!mainRef) {
    throw new Error(`${owner}/${repo} has no 'main' branch yet`);
  }
  const trunkCommitSha = mainRef.object.sha;
  const trunkCommit = await gh.getCommit(token, owner, repo, trunkCommitSha);
  const treeData = await gh.getTreeRecursive(token, owner, repo, trunkCommit.tree.sha);
  if (treeData.truncated) {
    throw new Error("Trunk tree is too large for a single recursive fetch — pagination not implemented yet");
  }

  const blobEntries = treeData.tree.filter((entry) => entry.type === "blob");
  const filesByPath = {};
  await mapWithConcurrency(blobEntries, 8, async (entry) => {
    filesByPath[entry.path] = await gh.getBlob(token, owner, repo, entry.sha);
  });

  return { trunkCommitSha, filesByPath };
}

function parseFolderNodes(filesByPath) {
  const folderNodes = new Map();
  for (const [path, content] of Object.entries(filesByPath)) {
    const lastSlash = path.lastIndexOf("/");
    const dirPath = lastSlash === -1 ? "" : path.slice(0, lastSlash);
    const fileName = lastSlash === -1 ? path : path.slice(lastSlash + 1);
    const folder = ensureFolderNode(folderNodes, dirPath);
    if (fileName === "_folder.json") {
      folder.order = JSON.parse(content).order || [];
    } else {
      folder.bookmarks.set(fileName, JSON.parse(content));
    }
  }
  return folderNodes;
}

async function rebuildChromeFolder(folderNodes, dirPath, chromeParentId) {
  const folder = folderNodes.get(dirPath);
  if (!folder) return 0;
  let created = 0;
  for (const name of folder.order) {
    if (name.endsWith("/")) {
      const childDirName = name.slice(0, -1);
      const childPath = `${dirPath}/${childDirName}`;
      const newFolder = await chrome.bookmarks.create({ parentId: chromeParentId, title: childDirName });
      created += await rebuildChromeFolder(folderNodes, childPath, newFolder.id);
    } else {
      const record = folder.bookmarks.get(name);
      if (!record) continue; // order referenced a file with no matching content — skip defensively
      await chrome.bookmarks.create({ parentId: chromeParentId, title: record.title, url: record.url });
      created++;
    }
  }
  return created;
}

export async function pull() {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to GitHub");
  const { repoOwner, repoName } = await getSettings();

  const { trunkCommitSha, filesByPath } = await fetchTrunkFileMap(token, repoOwner, repoName);
  const folderNodes = parseFolderNodes(filesByPath);

  let bookmarksCreated = 0;
  for (const [rootDirName, chromeRootId] of Object.entries(REVERSE_ROOT_FOLDER_NAMES)) {
    if (!folderNodes.has(rootDirName)) continue; // trunk has no data for this root — leave local untouched

    const existingChildren = await chrome.bookmarks.getChildren(chromeRootId);
    for (const child of existingChildren) {
      if (child.url === undefined) {
        await chrome.bookmarks.removeTree(child.id);
      } else {
        await chrome.bookmarks.remove(child.id);
      }
    }

    bookmarksCreated += await rebuildChromeFolder(folderNodes, rootDirName, chromeRootId);
  }

  await saveShadow({ files: filesByPath, trunkSha: trunkCommitSha });

  return { pulled: true, bookmarksCreated, trunkSha: trunkCommitSha };
}
