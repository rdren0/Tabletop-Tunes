# Tabletop Tunes — Owlbear Rodeo music extension

Paste YouTube links, queue them up, and play them in sync with your party.
Playback state lives in the room's metadata, so every connected client stays in
sync automatically — when the GM hits play or skips a track, everyone's popover
follows.

## How it works

- **Playback** — uses the official YouTube IFrame Player API, so videos and
  playlists play natively with full transport control.
- **Sync** — only the GM and any players granted DJ privileges can add songs or
  control transport (play/pause/skip/remove). Everyone else can view the queue
  and listen, but can't touch it. State is stored in `OBR.room` metadata and
  pushed to all clients via `OBR.room.onMetadataChange`.
- **DJ privileges** — the GM can grant individual players transport control via
  the ⚙ button in the transport row, which opens a panel listing everyone
  currently in the party (`OBR.party.getPlayers()`). Granted players get the
  same play/pause/skip/remove/jump-to-track controls as the GM; revoking is the
  same toggle. DJ status is stored in room metadata (`djIds`), so it's visible
  to everyone and persists for the session.
- **Requests** — listeners without control can propose a track. A GM or DJ
  approves or declines it, and the requester sees which happened; decided
  requests are swept from room metadata a minute later.
- **Auto-advance** — only one client advances the queue when a track ends, so
  multiple connected controllers don't race to skip simultaneously.
- **Theme** — the panel follows Owlbear's own light/dark setting via
  `OBR.theme`, rather than the operating system's.
- **Per-listener audio** — volume and mute are each listener's own, stored in
  `localStorage` with `OBR.player` metadata as a fallback for browsers that
  deny embedded frames their own storage.

## Local development

```bash
npm install
npm run dev
```

Owlbear Rodeo needs your extension served over HTTPS to load it, so `npm run
dev` alone can't exercise the OBR integration — the panel will sit on
"Connecting to Owlbear Rodeo…" forever, because `OBR.onReady` never fires
outside Owlbear.

To work on the UI without deploying:

```bash
npm run dev:ui
```

This serves `preview.html` with the Owlbear SDK swapped for an in-memory mock
(`src/preview/`), so the real `App` renders in a plain browser tab with
controls for theme, role, and a seeded room. The alias lives only in
`vite.preview.config.ts` — the production build never resolves the mock.

## Deploy (Netlify)

```bash
npm run build
```

Then either drag the `dist/` folder into Netlify's deploy UI, or connect the
repo and set:

- Build command: `npm run build`
- Publish directory: `dist`

Netlify serves `public/manifest.json` and the icons automatically, since Vite
copies everything in `public/` into `dist/` unchanged. `netlify.toml` sets the
CORS headers Owlbear needs to fetch the manifest and icons cross-origin.

**Bump the version in both `package.json` and `public/manifest.json` on every
deploy.** Owlbear caches the manifest, and the version is the only signal it
has that anything changed.

## Install into Owlbear Rodeo

1. In Owlbear Rodeo, open your profile menu → **Add Extension**.
2. Paste the manifest URL: `https://tabletop-tunes.com/manifest.json`
3. Open a room, enable **Tabletop Tunes** in the room's extension list.
4. Click the extension's icon in the top-left action bar to open the popover.

## Support

Questions, bug reports and feature requests go to
[the issue tracker](https://github.com/rdren0/Tabletop-Tunes/issues).

Opening an issue there needs a GitHub account, which most people at a table
won't have — so <rdrennan0@gmail.com> works too, and is linked from the panel
alongside the tracker.

## Known limitations

- **Mobile autoplay.** Mobile browsers refuse to start audio without a user
  gesture, so a listener joining a playing room may land in muted playback and
  need to tap to hear it. The player retries and falls back to muted playback
  rather than staying silent.
- **Reordering on touch.** Drag-and-drop is mouse-only; the ▲/▼ buttons on each
  row do the same job on a phone or from the keyboard.
- **No search** — this is a "paste a link" tool, not a search UI.

## Possible extensions

- Add a "shuffle" toggle.
- Let non-GM players vote to skip.
- Ambience: looping background beds layered under the queue. The component
  (`src/components/AmbienceStage.tsx`) and the `ambience` room-metadata field
  are still present; the UI was removed pending a fix for autoplay behaviour.
