# Privacy Policy — bmcentral

_Last updated: 2026-09-23_

## What this extension accesses

bmcentral reads and writes your browser's bookmarks (`bookmarks` permission) in order
to sync them across your devices.

## Where your data goes

Your bookmark data (titles, URLs, and folder structure) goes directly from your
browser to the GitHub repository **you** configure in the extension's settings, using
**your own** GitHub account (via GitHub's OAuth Device Flow).

**This extension has no backend server.** There is no intermediary, no analytics
service, and no third party — including the developer — that receives, stores, or has
access to your bookmark data. The only network communication is directly between your
browser and GitHub's own API (`api.github.com`, `github.com`).

## What's stored locally

The extension stores the following in your browser's local extension storage
(`chrome.storage.local`), which never leaves your device except as described above:

- A GitHub access token and refresh token, obtained via Device Flow login
- Your configured repository owner/name and device name settings
- A local cache of the last-synced bookmark state, used to compute what's changed

This data is not accessible to the developer or any other party — it lives only in
your own browser profile.

## Third parties

The only third party this extension communicates with is **GitHub**
(`github.com` / `api.github.com`), via the [BillsBookmarkManager GitHub App](https://github.com/apps/billsbookmarkmanager),
which is what you authorize to access the repository you choose. GitHub's own privacy
policy governs data stored in your repository:
https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement

## Data deletion

- To stop syncing and remove all locally stored data (including your access token),
  uninstall the extension.
- To remove your bookmark data from GitHub, delete the repository (or the relevant
  branches) yourself, and revoke the App's access from your GitHub account settings
  if you no longer want it authorized.

## Source code

bmcentral is open source: https://github.com/segfahlt/bmcentral

## Contact

Open an issue at https://github.com/segfahlt/bmcentral/issues
