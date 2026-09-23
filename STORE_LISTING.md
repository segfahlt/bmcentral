# Chrome Web Store listing draft

Reference copy for the Developer Dashboard fields. Edit freely — this isn't consumed
by the extension itself.

## Short description (max 132 characters)

```
Sync bookmarks across Chrome, Brave, and Edge using your own GitHub repo. No server, no account with us, no tracking.
```

## Detailed description

```
bmcentral syncs your browser bookmarks across machines and browsers — Chrome, Brave,
Edge — by storing them as plain files in a GitHub repository you own and control.

There is no backend server. Your bookmarks travel directly from your browser to your
own GitHub repository. Nobody else — including the developer — ever sees them.

HOW IT WORKS
- Push: sends your local bookmark changes to a branch and opens a pull request
  against your repo's main branch, so every change is reviewable before it's final.
- Pull: replaces your local bookmarks with what's on your repo's main branch.
- Backup: takes a full snapshot of your current bookmarks before anything risky
  happens, kept as permanent history you can never accidentally overwrite.
- Restore: brings back your last backup if something goes wrong.

SETUP (takes about 5 minutes)

1. Create a GitHub repository to hold your bookmarks (public or private — your
   choice). It needs at least one commit so it has a default branch.

2. Install the bmcentral GitHub App on that repository:
   https://github.com/apps/billsbookmarkmanager
   This is what lets the extension read and write to your repo — it only gets
   access to the repository you choose to install it on.

3. Open the extension's Settings (click the extension icon, then "Settings").

4. Click "Connect to GitHub" and follow the device code flow to authorize.

5. Enter your repository owner and name, and a name for this device (your
   machine's hostname works well — it keeps your identity consistent if you
   ever reinstall the extension). Click Save — this automatically backs up
   and pushes your current bookmarks.

6. On each additional machine: install the extension, repeat steps 3-5 (the
   GitHub App only needs to be installed on the repo once, not per device).
   Use Pull to bring down bookmarks from other devices, Push to send up
   local changes.

7. Review and merge the pull requests it opens on GitHub, at your own pace.

Full documentation and source code: https://github.com/segfahlt/bmcentral
```

## Category

Productivity

## Permission justifications (Privacy practices tab)

**`bookmarks`**
```
Required to read the user's bookmark tree (to sync it to their own GitHub
repository) and to write bookmarks back (to apply changes pulled from other
devices).
```

**`storage`**
```
Stores the user's GitHub authentication token, repository settings, and a local
cache of the last-synced state, all locally in the browser via chrome.storage.local.
Never transmitted anywhere except as part of authenticated requests to GitHub's own
API on the user's behalf.
```

**Host permission: `https://api.github.com/*`, `https://github.com/*`**
```
Required to read/write the user's chosen GitHub repository (via GitHub's REST and
Git Data APIs) and to perform OAuth Device Flow authentication. No other host is
ever contacted.
```

**Privacy policy URL**
```
https://github.com/segfahlt/bmcentral/blob/trunk/PRIVACY.md
```

## Single purpose description

```
Sync a user's browser bookmarks across their own devices and browsers, using a
GitHub repository the user owns as the storage backend.
```
