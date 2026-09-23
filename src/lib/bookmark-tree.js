// Converts the live chrome.bookmarks tree into the repo's file layout:
// one JSON file per bookmark. A folder's existence and contents come
// entirely from which files/subfolders are actually present under its path
// — there's no separate list a device could clobber. Order is not stored
// at all; it's recomputed on rebuild (folders alpha, then bookmarks alpha
// by title — see sync.js). _folder.json is written only as a placeholder
// for a folder that's otherwise completely empty, since git can't
// represent an empty directory any other way.
// Root folder names are pinned to Chrome's well-known root ids (not the
// locale-dependent titles) so two devices in different languages still
// agree on "Bookmarks Bar" / "Other Bookmarks" / "Mobile Bookmarks".

import { bookmarkId } from "./uuid5.js";

export const ROOT_FOLDER_NAMES = {
  "1": "Bookmarks Bar",
  "2": "Other Bookmarks",
  "3": "Mobile Bookmarks",
};

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

  async function walkFolder(node, dirPath) {
    const usedDirNames = new Set();
    const usedFileNames = new Set();
    let childCount = 0;

    for (const child of node.children || []) {
      if (child.children) {
        let dirName = sanitizeName(child.title);
        dirName = dedupeDirName(dirName, usedDirNames);
        const childPath = dirPath ? `${dirPath}/${dirName}` : dirName;
        await walkFolder(child, childPath);
        childCount++;
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
        childCount++;
      }
    }

    if (childCount === 0) {
      const markerPath = dirPath ? `${dirPath}/_folder.json` : "_folder.json";
      fileMap.set(markerPath, "{}\n");
    }
  }

  for (const rootChild of root.children || []) {
    const dirName = ROOT_FOLDER_NAMES[rootChild.id];
    if (!dirName) continue;
    await walkFolder(rootChild, dirName);
  }

  return fileMap;
}
