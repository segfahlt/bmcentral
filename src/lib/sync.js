// Push: diff the live bookmark tree against the last-known-pushed snapshot,
// commit the diff to this device's branch (rebased onto current trunk),
// open or update a PR against the repo's default branch. Never writes to
// the default branch directly — the default branch name is resolved from
// GitHub (repo.default_branch), never hardcoded.
//
// Pull: full wipe-and-rebuild of the local bookmark tree from trunk. Trunk
// is truth — this intentionally does not try to merge, so it only scopes
// its wipe to root folders trunk actually has data for (a root trunk has
// never seen is left completely untouched, not emptied). Always backs up
// first (see backupNow) and aborts rather than wiping local bookmarks if
// that backup fails.
//
// Backups: backupNow() snapshots the full current local bookmark tree as a
// new commit on backups/<device> — a plain, never-force-pushed, append-only
// branch, so every backup ever taken stays recoverable via its own commit
// history, independent of sync/<device> or trunk and durable even if this
// device's local storage is lost. restoreLastBackup() wipes local bookmarks
// and rebuilds from that branch's latest commit.

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

function requireDeviceName(settings) {
  if (!settings.deviceName) throw new Error("Set a device name in options first");
  return settings.deviceName;
}

async function getDefaultBranch(token, owner, repo) {
  const repoInfo = await gh.getRepo(token, owner, repo);
  return repoInfo.default_branch;
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

// Bounded-concurrency map, so a large trunk/backup doesn't fire hundreds of
// simultaneous requests and trip GitHub's secondary rate limiting.
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

export async function push() {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to GitHub");
  const settings = await getSettings();
  const { repoOwner, repoName } = settings;
  const deviceName = requireDeviceName(settings);

  const desiredMap = await buildDesiredFileMap();
  const shadow = await getShadow();
  const { changed, removed } = diffMaps(desiredMap, shadow.files);

  if (changed.length === 0 && removed.length === 0) {
    return { pushed: false, reason: "no changes" };
  }

  const defaultBranch = await getDefaultBranch(token, repoOwner, repoName);
  const branchName = `sync/${deviceName}`;

  // push() always diffs against current trunk, but shadow reflects "what I
  // last told GitHub", not "what's actually merged". If a previous push's PR
  // is still open, trunk hasn't caught up to what shadow believes is true —
  // diffing against trunk now would reference paths that don't exist there
  // yet (a common cause of GitHub's GitRPC::BadObjectState on tree creation).
  // Refuse rather than silently build a broken commit.
  const openPr = await gh.findOpenPull(token, repoOwner, repoName, branchName, defaultBranch);
  if (openPr) {
    throw new Error(
      `You already have an open PR for this device (#${openPr.number}): ${openPr.html_url}\n` +
        `Merge or close it before pushing again, so trunk and this device's local state stay in sync.`
    );
  }

  const trunkRef = await gh.getRef(token, repoOwner, repoName, `heads/${defaultBranch}`);
  if (!trunkRef) {
    throw new Error(
      `${repoOwner}/${repoName} has no commits on its default branch ('${defaultBranch}') yet — ` +
        `push an initial commit manually first, so the extension always syncs through a reviewable PR, ` +
        `even for the first import.`
    );
  }
  const trunkCommitSha = trunkRef.object.sha;
  const trunkCommit = await gh.getCommit(token, repoOwner, repoName, trunkCommitSha);
  const trunkTreeSha = trunkCommit.tree.sha;

  const changedEntries = await mapWithConcurrency(changed, 8, async ([path, content]) => {
    const blobSha = await gh.createBlob(token, repoOwner, repoName, content);
    return { path, mode: "100644", type: "blob", sha: blobSha };
  });
  const removedEntries = removed.map((path) => ({ path, mode: "100644", type: "blob", sha: null }));
  const treeEntries = [...changedEntries, ...removedEntries];

  const newTreeSha = await gh.createTree(token, repoOwner, repoName, trunkTreeSha, treeEntries);
  const commitMessage = `Sync from ${deviceName}: ${changed.length} changed, ${removed.length} removed`;
  const newCommitSha = await gh.createCommit(token, repoOwner, repoName, commitMessage, newTreeSha, trunkCommitSha);

  const branchRef = `heads/${branchName}`;
  const existingBranch = await gh.getRef(token, repoOwner, repoName, branchRef);
  if (existingBranch) {
    await gh.updateRef(token, repoOwner, repoName, branchRef, newCommitSha, true);
  } else {
    await gh.createRef(token, repoOwner, repoName, `refs/${branchRef}`, newCommitSha);
  }

  let pr = await gh.findOpenPull(token, repoOwner, repoName, branchName, defaultBranch);
  if (!pr) {
    try {
      pr = await gh.createPull(
        token,
        repoOwner,
        repoName,
        `Sync from ${deviceName}`,
        branchName,
        defaultBranch,
        `Automated bookmark sync from device "${deviceName}".\n\n${changed.length} file(s) changed, ${removed.length} removed.`
      );
    } catch (err) {
      // Lost a race with another concurrent push (e.g. a double-click) — GitHub
      // already has a PR for this branch, so just look it up instead of failing.
      if (err.message.includes("A pull request already exists")) {
        pr = await gh.findOpenPull(token, repoOwner, repoName, branchName, defaultBranch);
        if (!pr) throw err;
      } else {
        throw err;
      }
    }
  }

  const newShadowFiles = { ...shadow.files };
  for (const [path, content] of changed) newShadowFiles[path] = content;
  for (const path of removed) delete newShadowFiles[path];
  await saveShadow({ files: newShadowFiles, trunkSha: trunkCommitSha });

  return { pushed: true, changed: changed.length, removed: removed.length, pr: pr.html_url };
}

// Membership comes entirely from which paths exist under a directory —
// _folder.json (if present at all) is just an empty-folder placeholder and
// carries no data worth reading beyond "this folder exists".
function parseFolderNodes(filesByPath) {
  const folderPaths = new Set();
  const bookmarksByFolder = new Map();

  function ensureFolder(path) {
    folderPaths.add(path);
    if (!bookmarksByFolder.has(path)) bookmarksByFolder.set(path, new Map());
  }

  // Register a directory AND every ancestor above it — a folder whose only
  // content is nested subfolders (no direct file children of its own, e.g.
  // a root that holds only category folders) must still be recognized as
  // existing, or it gets treated as "source has no data here" and skipped.
  function ensureFolderAndAncestors(dirPath) {
    let path = dirPath;
    while (true) {
      ensureFolder(path);
      const lastSlash = path.lastIndexOf("/");
      if (lastSlash === -1) break;
      path = path.slice(0, lastSlash);
    }
  }

  for (const [path, content] of Object.entries(filesByPath)) {
    const lastSlash = path.lastIndexOf("/");
    const dirPath = lastSlash === -1 ? "" : path.slice(0, lastSlash);
    const fileName = lastSlash === -1 ? path : path.slice(lastSlash + 1);
    ensureFolderAndAncestors(dirPath);
    if (fileName === "_folder.json") continue;
    try {
      bookmarksByFolder.get(dirPath).set(fileName, JSON.parse(content));
    } catch {
      // Not a bookmark record we understand — skip it rather than fail the
      // whole pull/restore over one unexpected file.
    }
  }

  return { folderPaths, bookmarksByFolder };
}

function directSubfolderNames(folderPaths, parentPath) {
  const prefix = `${parentPath}/`;
  const names = [];
  for (const path of folderPaths) {
    if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
      names.push(path.slice(prefix.length));
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}

// Order is never stored — recomputed here every time: folders alphabetical
// first, then bookmarks alphabetical by title.
async function rebuildChromeFolder(folderPaths, bookmarksByFolder, dirPath, chromeParentId) {
  let created = 0;

  for (const name of directSubfolderNames(folderPaths, dirPath)) {
    const childPath = `${dirPath}/${name}`;
    const newFolder = await chrome.bookmarks.create({ parentId: chromeParentId, title: name });
    created += await rebuildChromeFolder(folderPaths, bookmarksByFolder, childPath, newFolder.id);
  }

  const records = [...(bookmarksByFolder.get(dirPath) || new Map()).values()];
  records.sort((a, b) => a.title.localeCompare(b.title));
  for (const record of records) {
    await chrome.bookmarks.create({ parentId: chromeParentId, title: record.title, url: record.url });
    created++;
  }

  return created;
}

// Shared by pull() and restoreLastBackup(): wipe+rebuild, scoped to only
// the root folders the source actually has data for.
async function applyFileMapToLocalBookmarks(filesByPath) {
  const { folderPaths, bookmarksByFolder } = parseFolderNodes(filesByPath);
  let bookmarksCreated = 0;
  for (const [rootDirName, chromeRootId] of Object.entries(REVERSE_ROOT_FOLDER_NAMES)) {
    if (!folderPaths.has(rootDirName)) continue; // source has no data for this root — leave local untouched

    const existingChildren = await chrome.bookmarks.getChildren(chromeRootId);
    for (const child of existingChildren) {
      try {
        if (child.url === undefined) {
          await chrome.bookmarks.removeTree(child.id);
        } else {
          await chrome.bookmarks.remove(child.id);
        }
      } catch (err) {
        // Already gone (e.g. removed as part of removing an earlier sibling,
        // or some other concurrent change) — the desired end state (this id
        // no longer exists) is already true, so skip rather than abort the
        // whole wipe partway through.
        console.warn(`Skipping removal of bookmark ${child.id} (${child.title}): ${err.message}`);
      }
    }

    bookmarksCreated += await rebuildChromeFolder(folderPaths, bookmarksByFolder, rootDirName, chromeRootId);
  }
  return bookmarksCreated;
}

// Shared by pull() (source = default branch) and restoreLastBackup()
// (source = backups/<device>).
async function fetchFileMapFromBranch(token, owner, repo, branchName) {
  const ref = await gh.getRef(token, owner, repo, `heads/${branchName}`);
  if (!ref) {
    throw new Error(`No branch '${branchName}' found on ${owner}/${repo}`);
  }
  const commitSha = ref.object.sha;
  const commit = await gh.getCommit(token, owner, repo, commitSha);
  const treeData = await gh.getTreeRecursive(token, owner, repo, commit.tree.sha);
  if (treeData.truncated) {
    throw new Error("Tree is too large for a single recursive fetch — pagination not implemented yet");
  }

  // Ignore anything outside the known bookmark root folders — a README,
  // LICENSE, or other file used to seed the repo's first commit shouldn't
  // ever reach bookmark-parsing logic.
  const knownRootPrefixes = Object.keys(REVERSE_ROOT_FOLDER_NAMES).map((name) => `${name}/`);
  const blobEntries = treeData.tree.filter(
    (entry) => entry.type === "blob" && knownRootPrefixes.some((prefix) => entry.path.startsWith(prefix))
  );
  const filesByPath = {};
  await mapWithConcurrency(blobEntries, 8, async (entry) => {
    filesByPath[entry.path] = await gh.getBlob(token, owner, repo, entry.sha);
  });

  return { commitSha, filesByPath };
}

async function backupNowWithAuth(token, repoOwner, repoName, deviceName) {
  const desiredMap = await buildDesiredFileMap();

  const treeEntries = await mapWithConcurrency([...desiredMap.entries()], 8, async ([path, content]) => {
    const blobSha = await gh.createBlob(token, repoOwner, repoName, content);
    return { path, mode: "100644", type: "blob", sha: blobSha };
  });

  // No base_tree: every backup is a complete, self-contained snapshot, not
  // a diff — so a bookmark deleted since the last backup can never linger
  // on in an older backup's tree.
  const newTreeSha = await gh.createTree(token, repoOwner, repoName, undefined, treeEntries);

  const branchName = `backups/${deviceName}`;
  const branchRef = `heads/${branchName}`;
  const existingBranch = await gh.getRef(token, repoOwner, repoName, branchRef);
  const parentSha = existingBranch ? existingBranch.object.sha : undefined;

  const commitMessage = `Backup from ${deviceName} — ${new Date().toISOString()}`;
  const newCommitSha = await gh.createCommit(token, repoOwner, repoName, commitMessage, newTreeSha, parentSha);

  if (existingBranch) {
    // Never force — this history must never be overwritten or lost.
    await gh.updateRef(token, repoOwner, repoName, branchRef, newCommitSha, false);
  } else {
    await gh.createRef(token, repoOwner, repoName, `refs/${branchRef}`, newCommitSha);
  }

  return { backedUp: true, branch: branchName, commit: newCommitSha };
}

export async function backupNow() {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to GitHub");
  const settings = await getSettings();
  const deviceName = requireDeviceName(settings);
  return backupNowWithAuth(token, settings.repoOwner, settings.repoName, deviceName);
}

export async function pull() {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to GitHub");
  const settings = await getSettings();
  const { repoOwner, repoName } = settings;
  const deviceName = requireDeviceName(settings); // backups are keyed by device name

  // Always back up current local state before wiping it. If this fails,
  // abort — never touch local bookmarks without a safety net in place.
  const backup = await backupNowWithAuth(token, repoOwner, repoName, deviceName);

  const defaultBranch = await getDefaultBranch(token, repoOwner, repoName);
  const { commitSha: trunkCommitSha, filesByPath } = await fetchFileMapFromBranch(
    token,
    repoOwner,
    repoName,
    defaultBranch
  );

  const bookmarksCreated = await applyFileMapToLocalBookmarks(filesByPath);

  await saveShadow({ files: filesByPath, trunkSha: trunkCommitSha });

  return { pulled: true, bookmarksCreated, trunkSha: trunkCommitSha, backupCommit: backup.commit };
}

export async function restoreLastBackup() {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to GitHub");
  const settings = await getSettings();
  const deviceName = requireDeviceName(settings);

  const { filesByPath } = await fetchFileMapFromBranch(
    token,
    settings.repoOwner,
    settings.repoName,
    `backups/${deviceName}`
  );
  const bookmarksCreated = await applyFileMapToLocalBookmarks(filesByPath);

  return { restored: true, bookmarksCreated };
}
