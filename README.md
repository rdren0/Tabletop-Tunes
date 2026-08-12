# Tabletop Tunes — Owlbear Rodeo music extension

Paste YouTube or Spotify links (single tracks, videos, or playlists), queue
them up, and play them in sync with your party. Playback state lives in the
room's metadata, so every connected client stays in sync automatically —
when the GM hits play or skips a track, everyone's popover follows.

## How it works

- **YouTube** — uses the official YouTube IFrame Player API, so videos and
  playlists play natively with full transport control.
- **Spotify** — uses Spotify's public [iFrame Embed API](https://developer.spotify.com/documentation/embeds/references/iframe-api),
  which doesn't require your own API keys or OAuth. Each listener's own
  Spotify session handles playback (full tracks for Premium accounts,
  30-second previews otherwise — that's a Spotify platform limit, not
  something this extension can change).
- **Sync** — only the GM and any players granted DJ privileges can add
  songs or control transport (play/pause/skip/remove). Everyone else can
  view the queue and listen, but can't touch it. State is stored in
  `OBR.room` metadata and pushed to all clients via `OBR.room.onMetadataChange`.
- **DJ privileges** — the GM can grant individual players transport control
  via the 🎧 button in the toolbar, which opens a panel listing everyone
  currently in the party (`OBR.party.getPlayers()`). Granted players get the
  same play/pause/skip/remove/jump-to-track controls as the GM; revoking is
  the same toggle. DJ status is stored in room metadata (`djIds`), so it's
  visible to everyone and persists for the session.
- **Auto-advance** — only the GM's client advances the queue when a track
  ends, so multiple connected players don't race to skip simultaneously.

## Local development

```bash
npm install
npm run dev
```

This starts a local dev server. Owlbear Rodeo needs your extension served
over HTTPS to load it, so local dev is really just for iterating on the UI —
you'll deploy to test the full OBR integration.

## Deploy (Netlify)

```bash
npm run build
```

Then either drag the `dist/` folder into Netlify's deploy UI, or connect
the repo and set:
- Build command: `npm run build`
- Publish directory: `dist`

Netlify serves `public/manifest.json` and `public/icon.svg` automatically
since Vite copies everything in `public/` into `dist/` unchanged.

## Install into Owlbear Rodeo

1. In Owlbear Rodeo, open your profile menu → **Add Extension**.
2. Paste your deployed manifest URL, e.g.
   `https://your-site.netlify.app/manifest.json`
3. Open a room, enable **Tabletop Tunes** in the room's extension list.
4. Click the extension's icon in the top-left action bar to open the popover.

## Known limitations / things worth knowing

- Spotify playback for non-Premium listeners is limited to 30-second
  previews — that's enforced by Spotify's embed player, not adjustable here.
- The "track ended" detection for Spotify is a best-effort heuristic (it
  watches for playback pausing near the end of the track), since Spotify's
  embed API doesn't emit an explicit "ended" event the way YouTube's does.
- Volume control only applies to YouTube; Spotify's embed widget doesn't
  expose a volume API, so Spotify listeners control volume via their own
  Spotify client/session.
- No search — this is a "paste a link" tool, not a Spotify/YouTube search
  UI. Could be added later using the respective public search APIs if
  useful.

## Possible extensions

- Add a "shuffle" toggle.
- Let non-GM players vote to skip.
- Persist queues per-scene instead of per-room, if you want different
  playlists per map/session.
