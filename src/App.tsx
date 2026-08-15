import { useEffect, useRef, useState } from "react";
import {
  hasPanelOpen,
  useIsGM,
  useAutoHeight,
  useObrReady,
  useObrTheme,
  usePlayerId,
  usePlayerName,
  useParty,
  usePresence,
  useRoomState,
} from "./lib/useOwlbear";
import { parseLink } from "./lib/parseLink";
import { fetchTitle } from "./lib/fetchTitle";
import { PlayerStage } from "./components/PlayerStage";
import { notifyGesture, unmuteAll } from "./lib/audioGestures";
import {
  QueueItem,
  REQUEST_RESULT_TTL_MS,
  SongRequest,
  pruneRequests,
  requestStatusOf,
} from "./types";
import {
  AudioPrefs,
  DEFAULT_AUDIO_PREFS,
  loadLocalPrefs,
  loadPlayerPrefs,
  savePlayerPrefs,
  savePrefs,
} from "./lib/preferences";

/** Where questions, bugs and requests go. Mirrored in the manifest's homepage_url. */
const ISSUES_URL = "https://github.com/rdren0/Tabletop-Tunes/issues";
/** The fallback channel: opening a GitHub issue requires an account, and most
 *  people at a table won't have one. */
const SUPPORT_EMAIL = "rdrennan0@gmail.com";

export default function App() {
  const ready = useObrReady();
  const appRef = useAutoHeight(ready);
  useObrTheme(ready);
  usePresence(ready);
  const isGM = useIsGM(ready);
  const playerId = usePlayerId(ready);
  const playerName = usePlayerName(ready);
  const party = useParty(ready);
  const [room, patchRoom] = useRoomState(ready);
  const [inputValue, setInputValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Read once, synchronously, so the panel opens at the listener's own level
  // rather than flashing the default. Null means they've never set one, which
  // is also what tells the effect below to fall back to Owlbear's copy.
  const storedPrefs = useRef<AudioPrefs | null>(loadLocalPrefs());
  const [volume, setVolume] = useState(
    () => storedPrefs.current?.volume ?? DEFAULT_AUDIO_PREFS.volume
  );
  const [muted, setMuted] = useState(
    () => storedPrefs.current?.muted ?? DEFAULT_AUDIO_PREFS.muted
  );
  // True when the browser refused audio and playback started muted, so the
  // speaker button can be explained rather than just looking wrong.
  const [autoMuted, setAutoMuted] = useState(false);
  // Open by default so a GM sees who holds DJ access without hunting for it,
  // but still collapsible once they've had a look.
  const [showDjPanel, setShowDjPanel] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  // Collapsed by default: support is worth having permanently reachable, but
  // it costs vertical space in a popover that sizes itself to its contents.
  const [showSupport, setShowSupport] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // The row is only draggable while the handle is held, so a press anywhere
  // else still selects text or works the buttons.
  const [dragArmed, setDragArmed] = useState(false);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [playlistIds, setPlaylistIds] = useState<string[]>([]);
  const [playlistTitles, setPlaylistTitles] = useState<Record<string, string>>({});
  // This client's live playback position, kept out of state so the 2s
  // heartbeat doesn't re-render the whole popover.
  const positionRef = useRef(0);
  /** Unmute inside the click itself, then let state follow. */
  function unmuteNow() {
    unmuteAll();
    setMuted(false);
    setAutoMuted(false);
    rememberAudio({ volume, muted: false });
  }

  /**
   * Records a choice the listener actually made. Never called for the
   * auto-mute: that's the browser refusing audio, not a preference, and
   * storing it would leave them silent in future sessions for a reason they
   * never chose.
   */
  const prefsTimer = useRef(0);
  function rememberAudio(prefs: AudioPrefs) {
    // Written now, not on a timer. Closing the popover destroys this iframe,
    // and a pending timeout inside it never runs — deferring this is what lost
    // the setting for anyone who adjusted the volume and closed the panel.
    savePrefs(prefs);
    // Only the Owlbear round trip waits, since dragging the slider fires
    // continuously and each write goes over the wire.
    window.clearTimeout(prefsTimer.current);
    prefsTimer.current = window.setTimeout(() => savePlayerPrefs(prefs), 300);
  }

  // Owlbear's copy is a backstop for browsers that deny the embedded frame its
  // own storage, so it's consulted only when localStorage held nothing. It's
  // session state, and letting it override the durable copy would undo a
  // setting the listener had actually chosen.
  useEffect(() => {
    if (!ready || storedPrefs.current) return;
    let cancelled = false;
    loadPlayerPrefs().then((prefs) => {
      if (cancelled || !prefs) return;
      setVolume(prefs.volume);
      setMuted(prefs.muted);
    });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  // Embedded players can be awkward to click directly, so treat any click in
  // the popover as the user gesture the browser wants before it allows audio.
  useEffect(() => {
    const handler = () => notifyGesture();
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // Clearing wipes the queue for everyone, so it takes two clicks. Forget the
  // pending confirmation if the second click doesn't come promptly.
  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  const isDJ = !!playerId && room.djIds.includes(playerId);
  const canControl = isGM || isDJ;
  const currentItem = room.currentIndex >= 0 ? room.queue[room.currentIndex] ?? null : null;
  const currentIsPlaylist = currentItem?.link.kind === "playlist";
  /**
   * What a listener should be told about the room. Silence has two very
   * different causes — nothing loaded yet versus deliberately paused — and
   * without saying which, a quiet panel just looks broken.
   */
  const listenerState: "empty" | "paused" | "playing" = !currentItem
    ? "empty"
    : room.isPlaying
      ? "playing"
      : "paused";
  // While the room is paused a listener has no use for the embed, and leaving
  // it there only invites a press that the heartbeat undoes a second later.
  const stageConcealed = !canControl && listenerState === "paused";
  // Whoever runs the room only ever acts on undecided requests; the decided
  // ones are hanging around purely as feedback for the person who asked.
  const pendingRequests = room.requests.filter((r) => requestStatusOf(r) === "pending");
  const myRequests = playerId ? room.requests.filter((r) => r.requestedById === playerId) : [];

  // Long tracks drift, so the client driving the queue republishes its position
  // periodically. Exactly one writer, same as auto-advance.
  useEffect(() => {
    if (!room.isPlaying) return;
    const timer = window.setInterval(() => {
      if (!isAdvancer()) return;
      patchRoom({ anchorPosition: positionRef.current, anchorAt: Date.now() });
    }, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.isPlaying, room.currentIndex, isGM, isDJ, playerId, party.length]);

  // Look up titles for the tracks inside an expanded playlist, keylessly.
  useEffect(() => {
    if (!showPlaylist || playlistIds.length === 0) return;
    const missing = playlistIds.filter((id) => !playlistTitles[id]).slice(0, 60);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        const title = await fetchTitle(`https://www.youtube.com/watch?v=${id}`, {
          source: "youtube",
          kind: "video",
          mediaId: id,
        });
        return [id, title] as const;
      })
    ).then((pairs) => {
      if (!cancelled) setPlaylistTitles((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPlaylist, playlistIds]);

  // A decided request clears itself once its notice has had time to be read.
  //
  // Only the advancer sweeps. Every client writes the whole room object, so
  // two writing at once means one silently overwrites the other; letting each
  // requester tidy up on a timer put unattended writers in the room, which is
  // the worst kind — nobody is watching when they clobber something. This is
  // the client that already owns auto-advance and the anchor republish.
  useEffect(() => {
    const resolved = room.requests.filter((r) => requestStatusOf(r) !== "pending");
    if (resolved.length === 0 || !isAdvancer()) return;
    const due =
      Math.min(...resolved.map((r) => r.resolvedAt ?? 0)) + REQUEST_RESULT_TTL_MS - Date.now();
    const timer = window.setTimeout(
      () => patchRoom({ requests: pruneRequests(room.requests) }),
      Math.max(due, 0)
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.requests, playerId, isGM, isDJ, party]);

  function setDJ(id: string, granted: boolean) {
    if (!isGM) return;
    const nextDjIds = granted ? [...new Set([...room.djIds, id])] : room.djIds.filter((d) => d !== id);
    patchRoom({ djIds: nextDjIds });
  }

  async function handleAdd() {
    if (!canControl) return;
    const link = parseLink(inputValue);
    if (!link) {
      setAddError("That isn't a YouTube video or playlist link.");
      return;
    }
    setAddError(null);
    setAdding(true);
    const title = await fetchTitle(inputValue, link);
    const item: QueueItem = {
      id: crypto.randomUUID(),
      url: inputValue.trim(),
      title,
      link,
    };
    const nextQueue = [...room.queue, item];
    const isFirstItem = room.currentIndex === -1;
    patchRoom({
      queue: nextQueue,
      currentIndex: isFirstItem ? 0 : room.currentIndex,
      isPlaying: isFirstItem ? true : room.isPlaying,
      ...(isFirstItem ? restartAnchor() : {}),
    });
    setInputValue("");
    setAdding(false);
  }

  /** Anchor at the top of a track — every client should start from the beginning. */
  function restartAnchor() {
    return { anchorPosition: 0, anchorAt: Date.now() };
  }

  /** Anchor at wherever this client currently is, for pause/resume in place. */
  function anchorHere() {
    return { anchorPosition: positionRef.current, anchorAt: Date.now() };
  }

  function playAt(index: number) {
    if (!canControl) return;
    setShowPlaylist(false);
    patchRoom({ currentIndex: index, isPlaying: true, ...restartAnchor() });
  }

  function togglePlay() {
    if (!canControl) return;
    patchRoom({ isPlaying: !room.isPlaying, ...anchorHere() });
  }

  function skip(delta: 1 | -1) {
    if (!canControl) return;
    if (room.queue.length === 0) return;
    const next = (room.currentIndex + delta + room.queue.length) % room.queue.length;
    setShowPlaylist(false);
    patchRoom({ currentIndex: next, isPlaying: true, ...restartAnchor() });
  }

  // A press on the handle that never becomes a drag would otherwise leave the
  // row armed, and a permanently-draggable row lets the title button start
  // drags again — the exact thing arming was meant to prevent.
  useEffect(() => {
    if (!dragArmed) return;
    const clear = () => setDragArmed(false);
    window.addEventListener("pointerup", clear);
    return () => window.removeEventListener("pointerup", clear);
  }, [dragArmed]);

  /** Clears every scrap of drag state, however the drag finished. */
  function endDrag() {
    setDragIndex(null);
    setOverIndex(null);
    setDragArmed(false);
  }

  /** Drag-and-drop reordering; the playing track keeps playing wherever it lands. */
  function moveItem(from: number, to: number) {
    if (!canControl || from === to) return;
    const nextQueue = [...room.queue];
    const [moved] = nextQueue.splice(from, 1);
    nextQueue.splice(to, 0, moved);
    const currentId = room.queue[room.currentIndex]?.id;
    const nextIndex = currentId ? nextQueue.findIndex((i) => i.id === currentId) : room.currentIndex;
    patchRoom({ queue: nextQueue, currentIndex: nextIndex });
  }

  function removeAt(index: number) {
    if (!canControl) return;
    const nextQueue = room.queue.filter((_, i) => i !== index);
    let nextIndex = room.currentIndex;
    let nextPlaying = room.isPlaying;
    if (index === room.currentIndex) {
      nextIndex = nextQueue.length === 0 ? -1 : Math.min(index, nextQueue.length - 1);
      nextPlaying = nextQueue.length === 0 ? false : room.isPlaying;
    } else if (index < room.currentIndex) {
      nextIndex = room.currentIndex - 1;
    }
    patchRoom({ queue: nextQueue, currentIndex: nextIndex, isPlaying: nextPlaying });
  }

  function handleClearClick() {
    if (!canControl) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    clearQueue();
  }

  function clearQueue() {
    if (!canControl) return;
    // Dropping currentIndex back to -1 unmounts the embed entirely, so the
    // stage returns to its empty state rather than holding the last track.
    patchRoom({ queue: [], currentIndex: -1, isPlaying: false });
  }

  /**
   * Exactly one client drives the queue forward, otherwise every controller
   * would skip on the same "ended" event and jump several tracks at once. The
   * GM owns that job; if no GM is running the panel, the lowest-sorted DJ who
   * is takes over, so the list keeps playing instead of stalling.
   *
   * Elected on who has the panel *open*, not who is in the room. Owlbear
   * destroys the iframe when the popover closes, so a GM sitting in the room
   * with the panel shut can't advance anything — and testing role alone made
   * every DJ stand down for them, which stopped the queue dead at the end of
   * a track.
   */
  function isAdvancer(): boolean {
    // This client is running by definition; nothing else to check.
    if (isGM) return true;
    if (party.some((p) => p.role === "GM" && hasPanelOpen(p))) return false;
    if (!playerId || !isDJ) return false;
    const runningDjs = [playerId, ...party.filter(hasPanelOpen).map((p) => p.id)]
      .filter((id) => room.djIds.includes(id))
      .sort();
    return runningDjs[0] === playerId;
  }

  function handleEnded() {
    if (!isAdvancer()) return;
    if (room.queue.length === 0) return;
    const next = (room.currentIndex + 1) % room.queue.length;
    patchRoom({ currentIndex: next, isPlaying: true, ...restartAnchor() });
  }

  /** A listener without control proposes a track for a GM or DJ to approve. */
  async function handleRequest() {
    const link = parseLink(inputValue);
    if (!link) {
      setAddError("That isn't a YouTube video or playlist link.");
      return;
    }
    setAddError(null);
    setAdding(true);
    const title = await fetchTitle(inputValue, link);
    const request: SongRequest = {
      id: crypto.randomUUID(),
      url: inputValue.trim(),
      title,
      link,
      requestedById: playerId ?? "unknown",
      requestedByName: playerName,
      status: "pending",
    };
    patchRoom({ requests: [...pruneRequests(room.requests), request] });
    setInputValue("");
    setAdding(false);
  }

  function approveRequest(request: SongRequest) {
    if (!canControl) return;
    const {
      requestedById: _id,
      requestedByName: _name,
      status: _status,
      resolvedAt: _resolvedAt,
      ...item
    } = request;
    const nextQueue = [...room.queue, item as QueueItem];
    const isFirstItem = room.currentIndex === -1;
    patchRoom({
      queue: nextQueue,
      requests: resolveRequest(request.id, "approved"),
      currentIndex: isFirstItem ? 0 : room.currentIndex,
      isPlaying: isFirstItem ? true : room.isPlaying,
      ...(isFirstItem ? restartAnchor() : {}),
    });
  }

  /**
   * Records a decision on the request list rather than deleting the entry —
   * a request that simply disappears leaves the person who asked unable to
   * tell approval from refusal.
   */
  function resolveRequest(id: string, status: "approved" | "declined"): SongRequest[] {
    return pruneRequests(
      room.requests.map((r) => (r.id === id ? { ...r, status, resolvedAt: Date.now() } : r))
    );
  }

  function dismissRequest(id: string) {
    if (!canControl) return;
    patchRoom({ requests: resolveRequest(id, "declined") });
  }

  if (!ready) {
    return <div className="app app--loading">Connecting to Owlbear Rodeo…</div>;
  }

  return (
    <div className="app" ref={appRef}>
      {/* The embed's own play button is the one control a browser always
          honours, so it stays reachable whenever the room is actually playing —
          that's the case where a listener needs it to defeat autoplay blocking.
          While the room is paused it's hidden behind a notice instead.
          Hidden, not unmounted: destroying the player would reload the video
          and lose its place every time the GM paused. */}
      <div className={stageConcealed ? "stage-wrap stage-wrap--concealed" : "stage-wrap"}>
        <PlayerStage
          item={currentItem}
          isPlaying={room.isPlaying}
          volume={volume}
          muted={muted}
          anchorPosition={room.anchorPosition}
          anchorAt={room.anchorAt}
          onTime={(seconds) => {
            positionRef.current = seconds;
          }}
          onAutoMuted={() => {
            setMuted(true);
            setAutoMuted(true);
          }}
          onAudioChange={({ volume: next, muted: nextMuted }) => {
            setVolume(next);
            setMuted(nextMuted);
            // Reaching into the embed's own speaker is the same act as using
            // ours, so it's remembered the same way.
            rememberAudio({ volume: next, muted: nextMuted });
            // Unmuting there also answers the "your browser blocked audio"
            // prompt, which would otherwise keep nagging.
            if (!nextMuted) setAutoMuted(false);
          }}
          canControl={canControl}
          onLocalTransport={(playing) => {
            if (!canControl) return;
            patchRoom({ isPlaying: playing, ...anchorHere() });
          }}
          onPlaylistLoaded={setPlaylistIds}
          onEnded={handleEnded}
        />
        {stageConcealed && (
          <div className="stage-notice" role="status">
            <span className="stage-notice-icon">⏸</span>
            <span>The GM has paused the music</span>
            <em>It picks back up for everyone when they hit play.</em>
          </div>
        )}
      </div>

      <div className="transport">
        {/* Transport belongs to whoever runs the room. A listener pressing these
            could never do anything, so they get a status line instead of four
            dead buttons — and the status says why nothing is sounding. */}
        {canControl ? (
          <>
            <button onClick={() => skip(-1)} disabled={room.queue.length === 0} title="Previous">
              ⏮
            </button>
            <button onClick={togglePlay} disabled={!currentItem} title={room.isPlaying ? "Pause" : "Play"}>
              {room.isPlaying ? "⏸" : "▶"}
            </button>
            <button onClick={() => skip(1)} disabled={room.queue.length === 0} title="Next">
              ⏭
            </button>
            <button
              className={confirmClear ? "clear clear--confirm" : "clear"}
              onClick={handleClearClick}
              disabled={room.queue.length === 0}
              title={
                confirmClear
                  ? "Click again to clear the queue for everyone"
                  : "Clear the queue and stop playback"
              }
            >
              {confirmClear ? "Clear all?" : "🗑"}
            </button>
          </>
        ) : (
          <span
            className={
              listenerState === "playing" ? "listener-status" : "listener-status listener-status--idle"
            }
          >
            {listenerState === "empty"
              ? "⏹ Waiting on the GM"
              : listenerState === "paused"
                ? "⏸ Paused by the GM"
                : "♪ Now playing"}
          </span>
        )}
        <div className="volume">
          <button
            type="button"
            className="mute"
            onClick={() => {
              if (muted) {
                unmuteNow();
                return;
              }
              setMuted(true);
              rememberAudio({ volume, muted: true });
            }}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted || volume === 0 ? "🔇" : "🔊"}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const next = Number(e.target.value);
              setVolume(next);
              // Moving the slider is itself an intent to hear something.
              if (muted) unmuteNow();
              rememberAudio({ volume: next, muted: false });
            }}
          />
        </div>
        {isGM && (
          <button
            className={showDjPanel ? "dj-toggle dj-toggle--open" : "dj-toggle"}
            onClick={() => setShowDjPanel((v) => !v)}
            title="Manage who can control the music (GM only)"
          >
            ⚙
          </button>
        )}
      </div>

      {autoMuted && muted && (
        <p className="hint hint--dj">
          Your browser blocked audio. Tap 🔇, or tap the video itself if that doesn't take.
        </p>
      )}
      {!canControl && (
        <p className="hint">
          {listenerState === "empty"
            ? "Listening only — the GM hasn't queued anything yet."
            : listenerState === "paused"
              ? "Listening only — the GM has paused playback, so it'll stay quiet until they resume."
              : "Listening only."}
        </p>
      )}
      {!isGM && isDJ && <p className="hint hint--dj">You have DJ access.</p>}

      {isGM && showDjPanel && (
        <div className="dj-panel">
          <p className="dj-panel-title">DJ privileges</p>
          {party.filter((p) => p.role !== "GM").length === 0 && (
            <p className="dj-panel-empty">No other players connected yet.</p>
          )}
          <ul className="dj-list">
            {party
              .filter((p) => p.role !== "GM")
              .map((p) => {
                const granted = room.djIds.includes(p.id);
                return (
                  <li key={p.id} className="dj-list-item">
                    <span>{p.name}</span>
                    <button
                      className={granted ? "dj-grant dj-grant--active" : "dj-grant"}
                      onClick={() => setDJ(p.id, !granted)}
                    >
                      {granted ? "Revoke DJ" : "Make DJ"}
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      )}


      {canControl && pendingRequests.length > 0 && (
        <div className="requests">
          <p className="dj-panel-title">Requests</p>
          <ul className="dj-list">
            {pendingRequests.map((request) => (
              <li key={request.id} className="request-item">
                <span className="request-title" title={request.url}>
                  {request.title}
                  <em> — {request.requestedByName}</em>
                </span>
                <span className="request-actions">
                  <button className="dj-grant dj-grant--active" onClick={() => approveRequest(request)}>
                    Add
                  </button>
                  <button className="dj-grant" onClick={() => dismissRequest(request.id)}>
                    No
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="add-row">
        <input
          type="text"
          placeholder={
            canControl ? "Paste a YouTube link…" : "Request a song…"
          }
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (canControl ? handleAdd() : handleRequest())}
        />
        <button
          onClick={canControl ? handleAdd : handleRequest}
          disabled={adding || !inputValue.trim()}
        >
          {adding ? "…" : canControl ? "Add" : "Request"}
        </button>
      </div>
      {!canControl && myRequests.length === 0 && (
        <p className="hint">Requests go to the GM and DJs to approve.</p>
      )}
      {addError && <p className="error">{addError}</p>}

      {/* What became of the tracks this player asked for. Decided entries are
          swept a minute after the fact, so this list stays short. */}
      {myRequests.length > 0 && (
        <ul className="my-requests">
          {myRequests.map((request) => {
            const status = requestStatusOf(request);
            return (
              <li key={request.id} className={`my-request my-request--${status}`}>
                <span className="my-request-title" title={request.url}>
                  {request.title}
                </span>
                <span className="my-request-status">
                  {status === "approved"
                    ? "✓ Added to the queue"
                    : status === "declined"
                      ? "✕ Not this time"
                      : "⏳ Pending approval"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* The song list had no label of its own, which left it reading as a
          loose pile of rows under the add box rather than a named section. */}
      <p className="section-heading">
        <span>Playlist</span>
        {room.queue.length > 0 && <span className="section-count">{room.queue.length}</span>}
      </p>

      <ul className="queue">
        {room.queue.map((item, index) => {
          const isCurrent = index === room.currentIndex;
          const expandable = isCurrent && currentIsPlaylist && playlistIds.length > 0;
          return (
            <li
              key={item.id}
              className={[
                "queue-item",
                isCurrent ? "queue-item--active" : "",
                dragIndex === index ? "queue-item--dragging" : "",
                overIndex === index && dragIndex !== index ? "queue-item--over" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              // Only armed by the handle below. The row is mostly a <button>,
              // and a mousedown on a button doesn't reliably start an
              // ancestor's drag — so a permanently-draggable row is one you
              // can't actually grab anywhere useful.
              draggable={canControl && dragArmed}
              onDragStart={(e) => {
                setDragIndex(index);
                // Firefox refuses to begin a drag at all unless the payload is
                // set, even when nothing reads it back.
                e.dataTransfer.setData("text/plain", String(index));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overIndex !== index) setOverIndex(index);
              }}
              onDragLeave={() => {
                if (overIndex === index) setOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) moveItem(dragIndex, index);
                endDrag();
              }}
              onDragEnd={endDrag}
            >
              {canControl && (
                <span
                  className="drag-handle"
                  title="Drag to reorder"
                  onPointerDown={() => setDragArmed(true)}
                  onPointerUp={() => setDragArmed(false)}
                >
                  ⠿
                </span>
              )}
              {/* Always rendered, even when empty, so every title starts at
                  the same x and the list doesn't shuffle sideways as the
                  current track changes. */}
              <span className="now-playing">
                {isCurrent && (
                  <span
                    className={room.isPlaying ? "eq eq--playing" : "eq"}
                    role="img"
                    aria-label={room.isPlaying ? "Now playing" : "Current track, paused"}
                    title={room.isPlaying ? "Now playing" : "Current track, paused"}
                  >
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </span>
              <button className="queue-title" onClick={() => playAt(index)} disabled={!canControl} title={item.url}>
                {item.title}
              </button>
              {expandable && (
                <button
                  className="expand"
                  onClick={() => setShowPlaylist((v) => !v)}
                  title={showPlaylist ? "Hide playlist contents" : "Show playlist contents"}
                >
                  {showPlaylist ? "▾" : "▸"} {playlistIds.length}
                </button>
              )}
              {/* Drag-and-drop is mouse-only — it never fires on a touchscreen,
                  and can't be reached from the keyboard. These are the same
                  reorder, available everywhere. */}
              {canControl && room.queue.length > 1 && (
                <span className="reorder">
                  <button
                    onClick={() => moveItem(index, index - 1)}
                    disabled={index === 0}
                    title="Move up"
                    aria-label={`Move ${item.title} up`}
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveItem(index, index + 1)}
                    disabled={index === room.queue.length - 1}
                    title="Move down"
                    aria-label={`Move ${item.title} down`}
                  >
                    ▼
                  </button>
                </span>
              )}
              <button className="remove" onClick={() => removeAt(index)} disabled={!canControl} title="Remove">
                ✕
              </button>
            </li>
          );
        })}

        {showPlaylist && currentIsPlaylist && (
          <li className="playlist-contents">
            {/* Without this the indented list is unlabelled, and it isn't
                obvious these are the playlist's tracks rather than the queue. */}
            <p className="section-heading">
              <span>Tracks in this playlist</span>
              <span className="section-count">{playlistIds.length}</span>
            </p>
            <ol>
              {playlistIds.map((id, i) => (
                <li key={`${id}-${i}`}>
                  <a href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer">
                    {playlistTitles[id] ?? "Loading…"}
                  </a>
                </li>
              ))}
            </ol>
          </li>
        )}
        {room.queue.length === 0 && <li className="queue-empty">Nothing queued yet.</li>}
      </ul>

      {/* Everyone in the room sees this, not just the GM — a listener hitting a
          problem is the person most likely to want to report one. */}
      <div className="support">
        <button
          type="button"
          className="support-toggle"
          onClick={() => setShowSupport((v) => !v)}
          aria-expanded={showSupport}
          aria-controls="support-details"
        >
          Problem or suggestion? <span aria-hidden="true">{showSupport ? "▾" : "▸"}</span>
        </button>
        {showSupport && (
          <p id="support-details" className="support-details">
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">
              Open an issue on GitHub
            </a>
            {" or email "}
            {/* The address is the link text on purpose: a sandboxed iframe may
                refuse to open a mailto:, and a dead link with no visible
                address would leave someone with nowhere to go. */}
            <a href={`mailto:${SUPPORT_EMAIL}?subject=Tabletop%20Tunes`}>{SUPPORT_EMAIL}</a>
          </p>
        )}
      </div>
    </div>
  );
}
