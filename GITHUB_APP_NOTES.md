# GitHub App permission note

For the BillsBookmarkManager App settings → **Permissions & events** →
"Add a note to your users explaining why you are requesting these permissions."
Shown to users on GitHub's own consent screen when they install the App —
separate from anything on the Chrome Web Store.

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

If GitHub enforces a shorter character limit than this fits, trim to:

```
Powers bmcentral (https://github.com/segfahlt/bmcentral), a bookmark-sync browser
extension. Contents access reads/writes your bookmark files; pull request access
lets each sync open a reviewable PR instead of writing directly to your default
branch. Install only on a repo dedicated to bookmark data.
```
