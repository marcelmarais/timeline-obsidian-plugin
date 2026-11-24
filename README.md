# Timeline: Location History

Bring the places your iPhone recorded with [Timeline](https://timeline.place) into Obsidian: insert a day's stops into any note, or keep a short list of them in your daily notes.

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

- The Timeline iPhone app with **Timeline Pro** ($3.99 a month or $29.99 a year, with a free week).
- Your iPhone sharing its history: in the Timeline app, open **Settings › Agents › Other agent**, sign in, and choose what to share.

The plugin reads the history your iPhone shares with Timeline Pro. It has no offline or file-import mode.

## Install

From Obsidian: **Settings › Community plugins › Browse**, search for **Timeline: Location History**, then **Install** and **Enable**.

By hand: copy `main.js`, `manifest.json` and `styles.css` from a [release](../../releases) into `<your vault>/.obsidian/plugins/timeline-location-history/`, then enable the plugin under **Settings › Community plugins**.

## Connect

1. Open **Settings › Timeline: Location History** and choose **Connect**.
2. Your browser opens Timeline. Sign in with Apple or Google, using the account you use in the Timeline iPhone app, and choose **Allow**.
3. The browser sends you back to Obsidian, which shows "Connected to Timeline."

Each device signs in on its own. Its sign-in stays in Obsidian's secure storage on that device and never goes into your vault, so it doesn't travel with Obsidian Sync, iCloud or git.

To disconnect, choose **Disconnect** in the plugin's settings. You can also remove Obsidian from **Settings › Agents** on [timeline.place](https://timeline.place/settings) or in the iPhone app, which ends access on every device at once.

## Use

Open the command palette and type "Timeline":

- **Insert today's places**: the day's stops, at the cursor.
- **Insert places for a date…**: pick today, yesterday or the open note's date, or type any date as `YYYY-MM-DD`.
- **Insert current location**: one line about where your iPhone last saw you, such as "At **Home** since 20:10 (last seen 20:25)".
- **Sync today's daily note**: writes the day's stops into today's daily note, and creates the note if it doesn't exist yet.
- **Sync this note's date**: does the same for any open note whose name has a date, such as `2026-11-24` or `2026-11-24 Berlin trip`.

### Daily notes

Syncing writes the stops between two hidden markers under a heading (`## Places` by default):

```markdown
## Places
<!-- timeline:start -->
- 09:05–17:40 · **Work** (8h 35m)
<!-- timeline:end -->
```

Syncing again replaces only what is between the markers, so the stops update as the day goes on. The plugin never changes anything outside the markers, including the heading. You can rename the heading or move the block anywhere in the note. If you delete one marker by hand, the plugin leaves the note alone and tells you.

With **Keep daily notes up to date** turned on, today's daily note refreshes when you open it and every 10 minutes while it is open, and yesterday's refreshes when you open it, if it already has places. Automatic syncing never creates a note.

The plugin reads your daily notes folder and date format from Obsidian's Daily notes plugin, or from Periodic Notes when that manages your daily notes. You can override either in the settings. When the plugin creates today's note, it fills in your daily notes template.

### What the lines mean

- **Bold** places are named places or your saved places, such as Home. *(probably)* marks a place Timeline guessed.
- `20:10–now` means your iPhone last saw you there, in the last few hours. `since 20:10 … (no departure reported yet)` means the iPhone hasn't said you left, which is different from knowing you stayed.
- *(from photos)* marks places found in your photos for days before Timeline was recording. The times are when you took the first and last photo there, so these lines have no durations.
- Notes are what you wrote on a stop in the Timeline app. A note an agent wrote shows the agent's name, such as "Note (Claude): …".
- Short stops can be missed, and a day without stops says why, for example "Not uploaded from your iPhone yet."

### Settings

- **Account**: connect, check or disconnect.
- **Daily notes**: automatic updates, daily notes folder, date format and heading.
- **Formatting**: include notes (on), include travel between stops (off), and write saved and named places as `[[wikilinks]]` instead of bold text (off).

## Privacy and network use

The plugin talks only to `https://timeline.place`, Timeline's own server, and only when you sign in, run a command, or have automatic updates on.

| When | Request | What is sent |
| --- | --- | --- |
| First sign-in on a vault | `POST /api/auth/oauth2/register` | The client name "Obsidian" and its `obsidian://` callback |
| Signing in | Your browser opens `/api/auth/oauth2/authorize` | A one-time code challenge; you sign in on Timeline's page |
| Signing in and staying signed in | `POST /api/auth/oauth2/token` | The one-time code, or the refresh token |
| Inserting or syncing a day | `GET /api/obsidian/day?date=…` | The date and your access token |
| Inserting the current location, or **Check** | `GET /api/obsidian/current` | Your access token |
| Disconnecting | `POST /api/auth/oauth2/revoke` | The refresh token, so it stops working |

- **Your vault never leaves your device.** The plugin sends no note contents, file names or vault details anywhere, and no analytics or telemetry. Only the requests above leave Obsidian.
- The plugin can only read. It can't change your history, your notes in Timeline or your account.
- It reads what your iPhone shares with Timeline Pro: your stops, saved places, travel between stops, places found from photos, and notes on stops. Coordinates are never sent to Obsidian. What the plugin writes into your notes stays in your vault.
- Timeline's privacy policy: [timeline.place/privacy](https://timeline.place/privacy).

## Development

```sh
pnpm install
pnpm dev        # rebuilds main.js on change
pnpm check      # typecheck, lint (eslint-plugin-obsidianmd), tests, production build
```

To try it in a vault, link this folder into the vault's plugins folder and enable the plugin:

```sh
ln -s "$PWD" "<your vault>/.obsidian/plugins/timeline-location-history"
```

The source is in `src/`:

- `main.ts`: commands, the sign-in callback and automatic updates.
- `auth.ts`: OAuth 2.1 with PKCE and refresh tokens.
- `api.ts`: requests to Timeline, and what each problem means.
- `format.ts`: the Markdown.
- `section.ts`: the managed block in a note.
- `dates.ts` and `daily-notes.ts`: dates and daily notes.
- `date-modal.ts` and `settings.ts`: the date picker and the settings.
- `obsidian-http.ts`: `requestUrl` and the device-only storage.

The tests in `tests/` cover the formatting, the block updates, dates and the API client, without Obsidian.

## Releasing

1. Bump the version: `pnpm version patch` (or `minor`/`major`). This updates `package.json`, `manifest.json` and `versions.json`. Raise `minAppVersion` in `manifest.json` first if the release needs a newer Obsidian.
2. Run `pnpm check`.
3. Push the commit and a tag that matches the version exactly, without a `v`, such as `1.0.1`.
4. Create a GitHub release for that tag and attach `main.js`, `manifest.json` and `styles.css` as separate files.

The first submission to the community directory:

1. Publish this folder as its own public GitHub repository, with `README.md`, `LICENSE` and `manifest.json` at its root, and make the `1.0.0` release as above.
2. Fork [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases), add an entry to the end of `community-plugins.json`, and open a pull request using the plugin template:

   ```json
   {
     "id": "timeline-location-history",
     "name": "Timeline: Location History",
     "author": "Marcel Marais",
     "description": "Insert the places your iPhone recorded with Timeline into any note, and keep a list of the day's stops in your daily notes.",
     "repo": "<owner>/<repository>"
   }
   ```

3. Answer the review bot's checks in the pull request until a reviewer approves it.
