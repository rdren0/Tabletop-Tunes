# Tabletop Tunes

An [Owlbear Rodeo](https://www.owlbear.rodeo/) extension that plays music in
sync with your party. Paste YouTube links, build a queue, and when the GM hits
play everyone hears the same thing at the same point in the track.

**Install:** add `https://tabletop-tunes.com/manifest.json` in Owlbear Rodeo
under your profile menu → Add Extension.

## What it does

**A shared queue.** YouTube videos and playlists, pasted as links. Whoever is
in charge can reorder the queue by dragging, jump to any track, remove entries,
or clear the whole thing.

**Synchronised playback.** Playback state lives in the room's metadata, so every
connected client converges on it. Clients extrapolate their expected position
from a shared anchor and seek only when they've drifted more than a couple of
seconds, so correction is rare enough not to be audible as stutter.

**Roles.** The GM controls everything by default and can grant DJ privileges to
individual players, giving them the same transport and queue control. Everyone
else listens: they see the queue and what's playing, but the controls are
theirs to watch, not touch.

**Song requests.** Listeners can propose a track. A GM or DJ approves or
declines it, and the person who asked is told which happened rather than
watching their request quietly disappear.

**Per-listener audio.** Volume and mute belong to each person, not the room, and
persist between sessions. The panel's controls and the embedded player's own
controls stay in step with each other in both directions.

**Ambient awareness.** A listener always knows why the room is quiet — nothing
queued yet, or the GM has paused — rather than being left with a panel that
looks broken.

## How it works

- **Playback** uses the official YouTube IFrame Player API.
- **Shared state** is stored in `OBR.room` metadata and broadcast to every
  client through `OBR.room.onMetadataChange`. It shares the room's lifecycle,
  not a scene's, so the queue survives switching maps.
- **Presence** is published in each player's own metadata. Owlbear destroys an
  extension's iframe when its popover closes, so being in the room and running
  the panel are different things — auto-advance and metadata cleanup are
  handled by exactly one client that is verifiably running, which stops several
  clients from skipping the same track at once.
- **Theme** follows Owlbear's own light/dark setting via `OBR.theme`, rather
  than the operating system's.
- **The popover sizes itself** to its contents via `OBR.action.setHeight`,
  instead of the single fixed height a manifest can declare.

## Requirements and limits

- **Everyone presses play once per session.** Browsers will not start audio the
  person sitting there didn't ask for, and a room that was already playing when
  the panel opened is exactly that. Chrome is the strictest about it, but every
  browser does it. Once a listener has pressed play on the video, the GM's
  controls drive their playback for the rest of the session. The panel detects
  this and prompts, rather than sitting there silent.
- **Mobile is stricter still.** Phones and tablets may land in muted playback
  even after a press; the player retries, then falls back to muted playback
  rather than staying silent, leaving the listener to unmute.
- **Reordering on touch.** Drag-and-drop is a mouse interaction. The ▲/▼
  buttons on each row do the same job on a phone or from the keyboard.
- **Concurrent edits.** Room metadata is last-write-wins. Two people changing
  the queue in the same instant means one change wins; the extension keeps the
  number of clients that write automatically down to one to make that rare.
- **No search.** This is a paste-a-link tool, not a music browser.

## Support

Bug reports, questions and feature requests are welcome at
[the issue tracker](https://github.com/rdren0/Tabletop-Tunes/issues), or by
email to <rdrennan0@gmail.com> if you'd rather not create a GitHub account.
