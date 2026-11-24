# Timeline Location History

Insert places recorded by the [Timeline](https://timeline.place) iPhone app into any Obsidian note, or sync each day's stops to your daily notes.

```markdown
## Places
- 09:05–17:40 · **Work** (8h 35m)
- 17:55–18:20 · **Rewe** *(probably)* (25m)
- 18:35–19:50 · **Kreuzberg Climbing Hall** (1h 15m)
  - Note: 80 kg felt easy
- 20:10–now · **Home**
```

Works on desktop, iPhone, iPad and Android.

## What you need

- The Timeline iPhone app with Timeline Pro ($3.99 a month or $29.99 a year, with a free week).
- History sharing turned on: in the Timeline iPhone app, open **Settings › Agents › Other agent**, sign in, and choose what to share.

The plugin reads your shared Timeline Pro history over the network. It has no offline or file-import mode.

## Install

From Obsidian: open **Settings › Community plugins › Browse**, search for **Timeline Location History**, then select **Install** and **Enable**.

By hand: copy `main.js`, `manifest.json` and `styles.css` from a [release](https://github.com/marcelmarais/timeline-obsidian-plugin/releases) into `<your vault>/.obsidian/plugins/timeline-location-history/`, then enable the plugin under **Settings › Community plugins**.

## Connect

1. Open **Settings › Timeline Location History** and choose **Connect**.
2. Your browser opens Timeline. Sign in with Apple or Google using the same account as the Timeline iPhone app, then choose **Allow**.
3. The browser sends you back to Obsidian, which shows "Connected to Timeline."

Each device signs in separately. Your sign-in stays in Obsidian's secure storage on that device and never goes into your vault, so it doesn't sync through Obsidian Sync, iCloud or git.

To disconnect, choose **Disconnect** in the plugin's settings. You can also remove Obsidian from **Settings › Agents** on [timeline.place](https://timeline.place/settings) or in the iPhone app, which ends access on every device at once.

## Use

Open the command palette and type "Timeline":

- **Insert today's places**: inserts today's stops at the cursor.
- **Insert places for a date…**: inserts stops for today, yesterday, the open note's date, or any `YYYY-MM-DD` date you type.
- **Insert current location**: inserts one line with the last position your iPhone uploaded, such as "At **Home** since 20:10 (last seen 20:25)".
- **Sync today's daily note**: writes today's stops into today's daily note, creating the note if it doesn't exist yet.
- **Sync this note's date**: updates the stops in any open note with a date in its name, such as `2026-11-24` or `2026-11-24 Berlin trip`.

### Daily notes

Syncing writes the stops between two Obsidian comments under a heading (`## Places` by default):

```markdown
## Places
%% timeline:start %%
- 09:05–17:40 · **Work** (8h 35m)
%% timeline:end %%
```

Syncing again replaces only what is between the markers, so the stops update as the day goes on. The plugin never changes anything outside the markers, including the heading. You can rename the heading or move the block anywhere in the note. If one of the markers is missing, the plugin leaves the note alone and tells you.

With **Keep daily notes up to date** turned on, today's daily note refreshes when opened and every 10 minutes while open. Yesterday's daily note refreshes on open if it already has a Timeline block. Automatic syncing never creates a note.

The plugin reads your daily notes folder and date format from Obsidian's Daily notes plugin, or from Periodic Notes when that manages your daily notes. You can override either in the settings. When the plugin creates today's note, it fills in your daily notes template.

### What the lines mean

- **Bold** text marks saved places, named places and addresses. *(probably)* marks a place Timeline guessed.
- `20:10–now` means your iPhone reported you there in the last few hours. `since 20:10 … (no departure reported)` means your iPhone hasn't reported a departure; it doesn't confirm you stayed there.
- *(from photos)* marks places found in your photos for days before Timeline was recording. The times are when you took the first and last photo there, so these lines have no durations.
- Notes are what you wrote on a stop in the Timeline app. A note an agent wrote shows the agent's name, such as "Note (Claude): …".
- Short stops can be missed. When a day has no stops, the line explains why, such as "Not uploaded from your iPhone yet."

### Settings

- **Account**: connect, check or disconnect.
- **Daily notes**: automatic updates, daily notes folder, date format and heading.
- **Formatting**: include notes (on), include travel between stops (off), and write saved and named places as `[[wikilinks]]` instead of bold text (off).

## Privacy and network use

The plugin connects only to `https://timeline.place` (Timeline's server), and only when you sign in, run a command, or have automatic updates turned on.

| When | Request | What is sent |
| --- | --- | --- |
| First sign-in on a vault | `POST /api/auth/oauth2/register` | The client name "Obsidian" and its `obsidian://` callback |
| Signing in | Your browser opens `/api/auth/oauth2/authorize` | A one-time code challenge; you sign in on Timeline's page |
| Signing in and staying signed in | `POST /api/auth/oauth2/token` | The one-time code or refresh token |
| Inserting or syncing a day | `GET /api/obsidian/day?date=…` | The date and your access token |
| Inserting the current location, or **Check** | `GET /api/obsidian/current` | Your access token |
| Disconnecting | `POST /api/auth/oauth2/revoke` | The refresh token to revoke it |

- Your vault stays on your device. The plugin sends no note contents, file names, vault metadata, analytics or telemetry; only the requests listed above leave Obsidian.
- The plugin has read-only access and can't change your history, your Timeline notes or your account.
- It reads what your iPhone shares with Timeline Pro: your stops, saved places, travel between stops, places found from photos, and notes on stops. Coordinates are never sent to Obsidian. What the plugin writes into your notes stays in your vault.
- Timeline's privacy policy: [timeline.place/privacy](https://timeline.place/privacy).

## Development

```sh
npm install
npm run dev     # rebuilds main.js on change
npm run check   # typecheck, lint (eslint-plugin-obsidianmd), tests, production build
```

To try it in a vault, link this folder into the vault's plugins folder and enable the plugin:

```sh
ln -s "$PWD" "<your vault>/.obsidian/plugins/timeline-location-history"
```

The source is in `src/`:

- `main.ts`: commands, the sign-in callback and automatic updates.
- `auth.ts`: OAuth 2.1 with PKCE and refresh tokens.
- `api.ts`: Timeline API requests and error messages.
- `format.ts`: Markdown formatting.
- `section.ts`: managed block updates in notes.
- `dates.ts` and `daily-notes.ts`: dates and daily notes.
- `date-modal.ts` and `settings.ts`: the date picker and the settings.
- `obsidian-http.ts`: `requestUrl` wrapper and device-only token storage.

Tests in `tests/` cover formatting, block updates, dates and the API client without requiring Obsidian.

## Releasing

1. Bump the version: `npm version patch --no-git-tag-version` (or `minor`/`major`). This updates `package.json`, `manifest.json` and `versions.json`. Raise `minAppVersion` in `manifest.json` first if the release needs a newer Obsidian version.
2. Run `npm run check`.
3. Push the commit and a tag that matches the version exactly, without a `v`, such as `1.0.1`.
4. Create a GitHub release for that tag and attach `main.js`, `manifest.json` and `styles.css` as separate files.

First submission to the community directory:

1. Copy this folder to [timeline-obsidian-plugin](https://github.com/marcelmarais/timeline-obsidian-plugin), the public repository Obsidian reads (`README.md`, `LICENSE` and `manifest.json` at its root), and make a release there as above.
2. Fork [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases), add an entry to the end of `community-plugins.json`, and open a pull request using the plugin template:

   ```json
   {
     "id": "timeline-location-history",
     "name": "Timeline Location History",
     "author": "Marcel Marais",
     "description": "Insert places recorded by the Timeline iPhone app into any note, or sync each day's stops to your daily notes.",
     "repo": "marcelmarais/timeline-obsidian-plugin"
   }
   ```

3. Address any checks from the review bot until a reviewer approves the pull request.
