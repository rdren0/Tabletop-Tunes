import { useEffect, useRef, useState } from "react";
import {
  useIsGM,
  useObrReady,
  usePlayerId,
  usePlayerName,
  useParty,
  useRoomState,
} from "./lib/useOwlbear";
import { parseLink } from "./lib/parseLink";
import { fetchTitle } from "./lib/fetchTitle";
import { readLocalAudio, writeLocalAudio } from "./lib/localAudio";
import { readFramePlaylist, subscribeFramePlaylist } from "./lib/framePlaylist";
import { AmbienceStream, QueueItem, SongRequest } from "./types";
import { SPOTIFY_ENABLED } from "./config";

const SOURCE_LABEL: Record<string, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
};

export default function App() {
  const ready = useObrReady();
  const isGM = useIsGM(ready);
  const playerId = usePlayerId(ready);
  const playerName = usePlayerName(ready);
  const party = useParty(ready);
  const [room, patchRoom] = useRoomState(ready);
  const [inputValue, setInputValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // These belong to this listener alone and are handed to the background page,
  // which is where playback actually happens.
  const [volume, setVolume] = useState(() => readLocalAudio().volume);
  const [muted, setMuted] = useState(() => readLocalAudio().muted);
  useEffect(() => {
    writeLocalAudio({ volume, muted });
  }, [volume, muted]);
  const [showDjPanel, setShowDjPanel] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [spotifyNotice, setSpotifyNotice] = useState(false);
  // Warn once per popover session, so it lands the first time it matters
  // without nagging on every Spotify link that follows.
  const spotifyWarned = useRef(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showAmbience, setShowAmbience] = useState(false);
  const [ambienceInput, setAmbienceInput] = useState("");
  const [ambienceError, setAmbienceError] = useState<string | null>(null);
  // Discovered by the background page's player and passed across frames.
  const [playlistIds, setPlaylistIds] = useState<string[]>(readFramePlaylist);
  useEffect(() => subscribeFramePlaylist(setPlaylistIds), []);
  const [playlistTitles, setPlaylistTitles] = useState<Record<string, string>>({});
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
  // Spotify's embed exposes no volume API, so the controls would silently lie.
  const spotifyActive = currentItem?.link.source === "spotify";
  const currentIsPlaylist = currentItem?.link.kind === "playlist";

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

  function setDJ(id: string, granted: boolean) {
    if (!isGM) return;
    const nextDjIds = granted ? [...new Set([...room.djIds, id])] : room.djIds.filter((d) => d !== id);
    patchRoom({ djIds: nextDjIds });
  }

  async function handleAdd() {
    if (!canControl) return;
    const link = parseLink(inputValue);
    if (!link) {
      setAddError(
        SPOTIFY_ENABLED
          ? "Unrecognized link. Use a YouTube video/playlist, or a Spotify track, album, playlist, or artist."
          : "That isn't a YouTube video or playlist link."
      );
      return;
    }
    if (!SPOTIFY_ENABLED && link.source === "spotify") {
      setAddError("Spotify is switched off for now — paste a YouTube link instead.");
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
    if (link.source === "spotify" && !spotifyWarned.current) {
      spotifyWarned.current = true;
      setSpotifyNotice(true);
    }
    setInputValue("");
    setAdding(false);
  }

  /** Anchor at the top of a track — every client should start from the beginning. */
  function restartAnchor() {
    return { anchorPosition: 0, anchorAt: Date.now() };
  }

  function playAt(index: number) {
    if (!canControl) return;
    setShowPlaylist(false);
    patchRoom({ currentIndex: index, isPlaying: true, ...restartAnchor() });
  }

  function togglePlay() {
    if (!canControl) return;
    // Only the flag: the background page owns the position and re-anchors
    // around this, since it's the side that knows where playback actually is.
    patchRoom({ isPlaying: !room.isPlaying });
  }

  function skip(delta: 1 | -1) {
    if (!canControl) return;
    if (room.queue.length === 0) return;
    const next = (room.currentIndex + delta + room.queue.length) % room.queue.length;
    setShowPlaylist(false);
    patchRoom({ currentIndex: next, isPlaying: true, ...restartAnchor() });
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

  /** A listener without control proposes a track for a GM or DJ to approve. */
  async function handleRequest() {
    const link = parseLink(inputValue);
    if (!link) {
      setAddError("That isn't a link this extension can play.");
      return;
    }
    if (!SPOTIFY_ENABLED && link.source === "spotify") {
      setAddError("Spotify is switched off for now — request a YouTube link instead.");
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
    };
    patchRoom({ requests: [...room.requests, request] });
    setInputValue("");
    setAdding(false);
    setRequestSent(true);
    window.setTimeout(() => setRequestSent(false), 4000);
  }

  function approveRequest(request: SongRequest) {
    if (!canControl) return;
    const { requestedById: _id, requestedByName: _name, ...item } = request;
    const nextQueue = [...room.queue, item as QueueItem];
    const isFirstItem = room.currentIndex === -1;
    patchRoom({
      queue: nextQueue,
      requests: room.requests.filter((r) => r.id !== request.id),
      currentIndex: isFirstItem ? 0 : room.currentIndex,
      isPlaying: isFirstItem ? true : room.isPlaying,
      ...(isFirstItem ? restartAnchor() : {}),
    });
  }

  /** Ambience is YouTube-only: it needs looping and volume, which Spotify lacks. */
  async function addAmbience() {
    if (!canControl) return;
    const link = parseLink(ambienceInput);
    if (!link || link.source !== "youtube" || link.kind !== "video") {
      setAmbienceError("Ambience needs a single YouTube video link.");
      return;
    }
    setAmbienceError(null);
    const title = await fetchTitle(ambienceInput, link);
    const stream: AmbienceStream = {
      id: crypto.randomUUID(),
      url: ambienceInput.trim(),
      title,
      videoId: link.mediaId,
      volume: 50,
      playing: false,
    };
    patchRoom({ ambience: [...room.ambience, stream] });
    setAmbienceInput("");
  }

  function updateAmbience(id: string, patch: Partial<AmbienceStream>) {
    if (!canControl) return;
    patchRoom({
      ambience: room.ambience.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  }

  function removeAmbience(id: string) {
    if (!canControl) return;
    patchRoom({ ambience: room.ambience.filter((s) => s.id !== id) });
  }

  function dismissRequest(id: string) {
    if (!canControl) return;
    patchRoom({ requests: room.requests.filter((r) => r.id !== id) });
  }

  if (!ready) {
    return <div className="app app--loading">Connecting to Owlbear Rodeo…</div>;
  }

  return (
    <div className="app">
      {/* Audio runs in the background page so it survives this panel closing;
          the popover is the control surface and shows what's playing. */}
      <div className="now-playing">
        {currentItem ? (
          <>
            <span className={`badge badge--${currentItem.link.source}`}>
              {SOURCE_LABEL[currentItem.link.source]}
            </span>
            <span className="now-playing-title" title={currentItem.url}>
              {currentItem.title}
            </span>
            <span className="now-playing-state">{room.isPlaying ? "▶" : "⏸"}</span>
          </>
        ) : (
          <span className="now-playing-title">Nothing playing.</span>
        )}
      </div>

      <div className="transport">
        <button onClick={() => skip(-1)} disabled={!canControl || room.queue.length === 0} title="Previous">
          ⏮
        </button>
        <button onClick={togglePlay} disabled={!canControl || !currentItem} title={room.isPlaying ? "Pause" : "Play"}>
          {room.isPlaying ? "⏸" : "▶"}
        </button>
        <button onClick={() => skip(1)} disabled={!canControl || room.queue.length === 0} title="Next">
          ⏭
        </button>
        <button
          className={confirmClear ? "clear clear--confirm" : "clear"}
          onClick={handleClearClick}
          disabled={!canControl || room.queue.length === 0}
          title={
            confirmClear
              ? "Click again to clear the queue for everyone"
              : "Clear the queue and stop playback"
          }
        >
          {confirmClear ? "Clear all?" : "🗑"}
        </button>
        <div className="volume">
          <button
            type="button"
            className="mute"
            onClick={() => setMuted((m) => !m)}
            disabled={spotifyActive}
            title={
              spotifyActive
                ? "Spotify volume is controlled from your own Spotify app"
                : muted
                  ? "Unmute"
                  : "Mute"
            }
          >
            {muted || volume === 0 ? "🔇" : "🔊"}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            disabled={spotifyActive}
            onChange={(e) => {
              setVolume(Number(e.target.value));
              setMuted(false);
            }}
          />
        </div>
        <button
          className={showAmbience ? "dj-toggle dj-toggle--open" : "dj-toggle"}
          onClick={() => setShowAmbience((v) => !v)}
          title="Ambience — looping sounds that layer under the queue"
        >
          🌧
        </button>
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

      {!canControl && <p className="hint">Listening only.</p>}
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

      {showAmbience && (
        <div className="dj-panel">
          <p className="dj-panel-title">Ambience</p>
          {room.ambience.length === 0 && (
            <p className="dj-panel-empty">
              Looping sounds that play under the queue — rain, a tavern, distant drums.
            </p>
          )}
          <ul className="dj-list">
            {room.ambience.map((stream) => (
              <li key={stream.id} className="ambience-item">
                <button
                  className={stream.playing ? "amb-toggle amb-toggle--on" : "amb-toggle"}
                  onClick={() => updateAmbience(stream.id, { playing: !stream.playing })}
                  disabled={!canControl}
                  title={stream.playing ? "Stop" : "Play"}
                >
                  {stream.playing ? "◼" : "▶"}
                </button>
                <span className="ambience-title" title={stream.url}>
                  {stream.title}
                </span>
                <input
                  className="ambience-volume"
                  type="range"
                  min={0}
                  max={100}
                  value={stream.volume}
                  disabled={!canControl}
                  title="Level in the mix (shared)"
                  onChange={(e) => updateAmbience(stream.id, { volume: Number(e.target.value) })}
                />
                <button
                  className="remove"
                  onClick={() => removeAmbience(stream.id)}
                  disabled={!canControl}
                  title="Remove"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {canControl && (
            <div className="add-row add-row--ambience">
              <input
                type="text"
                placeholder="YouTube link to loop…"
                value={ambienceInput}
                onChange={(e) => setAmbienceInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addAmbience()}
              />
              <button onClick={addAmbience} disabled={!ambienceInput.trim()}>
                Add
              </button>
            </div>
          )}
          {ambienceError && <p className="error">{ambienceError}</p>}
        </div>
      )}

      {canControl && room.requests.length > 0 && (
        <div className="requests">
          <p className="dj-panel-title">Requests</p>
          <ul className="dj-list">
            {room.requests.map((request) => (
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
            canControl
              ? SPOTIFY_ENABLED
                ? "Paste a YouTube or Spotify link…"
                : "Paste a YouTube link…"
              : "Request a song…"
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
      {!canControl && !requestSent && (
        <p className="hint">Requests go to the GM and DJs to approve.</p>
      )}
      {requestSent && <p className="hint hint--dj">Request sent.</p>}
      {addError && <p className="error">{addError}</p>}

      {spotifyNotice && (
        <div className="notice">
          <span>
            Heads up: Spotify only plays for listeners signed into their own account, and free
            accounts hear 30-second previews. YouTube plays for everyone.
          </span>
          <button className="notice-dismiss" onClick={() => setSpotifyNotice(false)} title="Dismiss">
            ✕
          </button>
        </div>
      )}

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
              ]
                .filter(Boolean)
                .join(" ")}
              draggable={canControl}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => {
                if (dragIndex !== null) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) moveItem(dragIndex, index);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              {canControl && (
                <span className="drag-handle" title="Drag to reorder">
                  ⠿
                </span>
              )}
              <span className={`badge badge--${item.link.source}`}>
                {SOURCE_LABEL[item.link.source]}
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
              <button className="remove" onClick={() => removeAt(index)} disabled={!canControl} title="Remove">
                ✕
              </button>
            </li>
          );
        })}

        {showPlaylist && currentIsPlaylist && (
          <li className="playlist-contents">
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
    </div>
  );
}
