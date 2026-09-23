# GitHub App permission note

For the BillsBookmarkManager App settings → **Permissions & events** →
"Add a note to your users explaining why you are requesting these permissions."
Shown to users on GitHub's own consent screen when they install the App —
separate from anything on the Chrome Web Store. **Hard limit: 240 characters.**

## Use this (236 characters)

```
Powers bmcentral (bookmark-sync extension). Contents: read/write bookmark files. Pull requests: each sync opens a reviewable PR instead of writing directly to your default branch. Use a bookmarks-only repo. github.com/segfahlt/bmcentral
```

## Longer version (over the limit — kept for the Chrome Web Store listing / README instead)

```
This app powers bmcentral, a browser extension that syncs your bookmarks across
devices by storing them as plain files in a repository you choose.

- Contents (read & write): to read your existing bookmark files and write updates
  when you sync from a device.
- Pull requests (read & write): to open a pull request for each sync, so changes
  are reviewable before they merge instead of writing directly to your default
  branch.

Install this app only on a repository dedicated to bookmark data — the extension
manages that repo's contents directly as part of normal syncing.

Source: https://github.com/segfahlt/bmcentral
```
