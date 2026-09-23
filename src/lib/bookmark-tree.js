// Converts the live chrome.bookmarks tree into the repo's file layout:
// one JSON file per bookmark. A folder's existence and contents come
// entirely from which files/subfolders are actually present under its path
// — there's no separate list a device could clobber. Order is not stored
// at all; it's recomputed on rebuild (folders alpha, then bookmarks alpha
// by title — see sync.js). A folder with nothing in it (no bookmarks, no
// non-empty subfolders) is simply not represented at all — empty folders
// aren't tracked or synced.
//
// Root folder names are matched by POSITION in chrome.bookmarks.getTree()'s
// root.children, not by literal id. Chromium's bookmark model always
// creates the three permanent roots in a fixed order (bar, other, mobile),
// but the actual id strings ("1"/"2"/"3") are allocated per-profile, not
// universal — hardcoding them broke cross-device sync the moment a
// profile's ids didn't happen to match the convention.

import { bookmarkId } from "./uuid5.js";

export const ROOT_FOLDER_NAMES_BY_INDEX = ["Bookmarks Bar", "Other Bookmarks", "Mobile Bookmarks"];


const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

function sanitizeName(name, maxlen = 60) {
  let clean = name.replace(ILLEGAL_CHARS, "").trim().replace(/\.+$/, "");
  clean = clean.replace(/\s+/g, " ");
  if (!clean) clean = "untitled";
  return clean.slice(0, maxlen).trimEnd();
}

function slugify(title, idSuffix, maxlen = 50) {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  slug = slug.slice(0, maxlen).replace(/^-+|-+$/g, "") || "bookmark";
  return `${slug}-${idSuffix}.json`;
}

function dedupeDirName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let i = 2;
  while (used.has(`${name}-${i}`)) i++;
  const finalName = `${name}-${i}`;
  used.add(finalName);
  return finalName;
}

function dedupeFilename(fname, used) {
  if (!used.has(fname)) {
    used.add(fname);
    return fname;
  }
  const base = fname.replace(/\.json$/, "");
  let i = 2;
  let candidate;
  do {
    candidate = `${base}-${i}.json`;
    i++;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

export async function buildDesiredFileMap() {
  const [root] = await chrome.bookmarks.getTree();
  const fileMap = new Map();

  // Returns true if this folder (or any descendant) produced at least one
  // file — a folder containing only other empty folders is itself empty
  // and produces nothing either.
  async function walkFolder(node, dirPath) {
    const usedDirNames = new Set();
    const usedFileNames = new Set();
    let hasContent = false;

    for (const child of node.children || []) {
      if (child.children) {
        let dirName = sanitizeName(child.title);
        dirName = dedupeDirName(dirName, usedDirNames);
        const childPath = dirPath ? `${dirPath}/${dirName}` : dirName;
        if (await walkFolder(child, childPath)) hasContent = true;
      } else if (child.url) {
        const id = await bookmarkId(child.url);
        const suffix = id.replace(/-/g, "").slice(-8);
        let fname = slugify(child.title, suffix);
        fname = dedupeFilename(fname, usedFileNames);

        const record = {
          id,
          url: child.url,
          title: child.title,
          dateAdded: child.dateAdded ? new Date(child.dateAdded).toISOString() : null,
        };
        const filePath = dirPath ? `${dirPath}/${fname}` : fname;
        fileMap.set(filePath, JSON.stringify(record, null, 2) + "\n");
        hasContent = true;
      }
    }

    return hasContent;
  }

  const rootChildren = root.children || [];
  for (let i = 0; i < rootChildren.length && i < ROOT_FOLDER_NAMES_BY_INDEX.length; i++) {
    await walkFolder(rootChildren[i], ROOT_FOLDER_NAMES_BY_INDEX[i]);
  }

  return fileMap;
}
