<img src="logo.png" width="96" alt="bmcentral logo" />

# bmcentral

A browser extension that syncs Chrome/Brave/Edge bookmarks across machines, using a
GitHub repository as the persistence layer — no backend server involved.

## How it works

The extension talks directly to GitHub's REST + Git Data API from its background
service worker. There's no Cloudflare Worker or any other server in the loop; a
Manifest V3 extension with `host_permissions` for `github.com`/`api.github.com` isn't
subject to normal page-level CORS restrictions, and GitHub's OAuth **Device Flow**
doesn't require a client secret (it's a public-client grant), so there's nothing that
needs to be kept confidential server-side.

Each device has its own identity (a device name you choose in Options) and its own
GitHub user access token (via Device Flow, scoped by a GitHub App installed on just
the bookmarks repo). Sync is deliberately **manual** — Push and Pull are explicit
actions, not automatic background sync — via two buttons in the extension popup, plus
Backup/Restore for safety.

### Push

Diffs your live bookmarks against this device's last-known-pushed state, commits the
diff to a `sync/<device>` branch (always rebased onto the repo's current default
branch — resolved from `repo.default_branch`, never hardcoded), and opens or updates a
pull request against it. **Never writes to the default branch directly** — every
change, even the first one from a new device, goes through a reviewable PR that you
merge yourself.

If a previous PR for this device is still open, Push refuses and tells you to merge
or close it first, rather than silently building a diff against a default branch that
doesn't yet match what this device believes is true.

### Pull

Full wipe-and-rebuild: fetches the default branch's current bookmark data and replaces
your local bookmarks with it. The default branch is treated as ground truth — this is
a deliberate design choice, not a merge — so it only touches root folders
(`Bookmarks Bar` / `Other Bookmarks` / `Mobile Bookmarks`) that the data actually has
something for; a root it has no data for is left completely untouched locally.

**Always backs up first** (see below) and aborts without touching local bookmarks if
that backup fails.

### Backup / Restore

`backups/<device>` is a plain, **append-only** branch — never force-pushed. Every
backup is a full, self-contained snapshot commit, so the entire history of backups
ever taken on a device stays permanently recoverable via that branch's own commit
log, independent of `sync/<device>` or the default branch — durable even if the
device's browser profile or local extension storage is lost entirely.

"Restore last backup" wipes local bookmarks and rebuilds from that branch's latest
commit. (Restoring from an older point in the history isn't built into the UI yet —
the commits are all still there via `git log`/`gh` on the `backups/<device>` branch if
you ever need to dig one out manually.)

## Data repo layout

The bookmarks repo mirrors your bookmark tree as plain files, so PRs stay reviewable:

```
Bookmarks Bar/
  Work/
    some-bookmark-title-a1b2c3d4.json   { id, url, title, dateAdded }
  another-bookmark-e5f6a7b8.json
Other Bookmarks/
Mobile Bookmarks/
```

- **Folder hierarchy = directory hierarchy.** A folder's existence and contents come
  entirely from which files/subfolders are present under its path — there's no
  separate list file a device could clobber or that could drift out of sync with
  reality.
- **Bookmark IDs are deterministic**: `uuid5(NAMESPACE_URL, url)` — the same URL
  always produces the same ID, so no device needs to coordinate ID assignment with
  any other, and cross-device identity for "is this the same bookmark" is a pure
  function of the URL.
- **Order is never stored.** It's recomputed on every rebuild: subfolders
  alphabetically first, then bookmarks alphabetically by title.
- **Empty folders aren't tracked.** A folder with nothing in it (no bookmarks, no
  non-empty subfolders) simply isn't represented in the repo at all — it won't survive
  a sync. This is a deliberate simplicity tradeoff, not an oversight.
- **No tags** — not a concept native to any browser's bookmark model, so it was
  dropped from the design rather than round-tripped awkwardly.
- **Root folders are matched by position, not id.** `chrome.bookmarks.getTree()`'s
  three permanent root folders (Bookmarks Bar, Other Bookmarks, Mobile Bookmarks) are
  always created in that fixed order by Chromium's bookmark model, but their id
  strings are allocated per-profile — `"1"`/`"2"`/`"3"` is a common convention, not a
  guarantee. Root ids are always resolved live against whichever machine is running,
  never hardcoded.

## Setup

1. **GitHub App**: register one with Device Flow enabled, `Contents: Read & write` and
   `Pull requests: Read & write` permissions, installed only on the bookmarks repo.
   No client secret or private key is ever used by this extension — delete the
   client secret from the App once created, it's dead weight.
2. Put the App's **Client ID** into `src/lib/github-auth.js` (`CLIENT_ID`).
3. Load unpacked: `brave://extensions` (or `chrome://extensions`) → Developer mode →
   "Load unpacked" → select this directory.
4. Open the extension's Options page → "Connect to GitHub" (Device Flow login) → set
   repo owner/name and a device name → Save. Saving triggers an initial backup + push
   automatically.
5. **Device naming**: use the machine's hostname, or something equally stable and
   memorable (e.g. `win10-laptop`, `linux-headless`) — not the auto-suggested random
   default. `chrome.storage.local` (where the device name lives) doesn't survive an
   extension uninstall, so a memorable, deliberately-chosen name is what lets you
   reclaim the same identity (and its `backups/<device>` history) after a reinstall.
   The Options page also lists existing `sync/*`/`backups/*` branches on the repo —
   click one to reuse it instead of drifting to a new, orphaned identity.

## Repo structure

```
manifest.json               Manifest V3 config
background.js                Service worker: message routing, in-flight sync guard
src/lib/
  uuid5.js                    Deterministic bookmark IDs
  github-auth.js               Device Flow login, token storage, auto-refresh
  github-api.js                Thin GitHub REST + Git Data API wrapper
  bookmark-tree.js              chrome.bookmarks tree -> repo file layout
  sync.js                       push() / pull() / backupNow() / restoreLastBackup()
src/options/                 Settings UI: GitHub connection, repo, device identity
src/popup/                   Push / Pull / Backup / Restore buttons
```

## Known limitations

- Very large bookmark trees: tree fetches use GitHub's recursive Git Trees API
  without pagination — a repo tree large enough to get truncated isn't handled yet.
- No in-extension UI for restoring anything other than the *latest* backup.
- Cross-device conflicts (e.g. two devices editing the same folder before either
  pulls) show up as real PR diffs/conflicts for manual review — intentional, not a
  bug: this project favors simple, human-reviewed merges over automatic conflict
  resolution.
