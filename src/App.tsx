import { useState } from "react";
import { useIsGM, useObrReady, usePlayerId, useParty, useRoomState } from "./lib/useOwlbear";
import { parseLink } from "./lib/parseLink";
import { fetchTitle } from "./lib/fetchTitle";
import { PlayerStage } from "./components/PlayerStage";
import { QueueItem } from "./types";

const SOURCE_LABEL: Record<string, string> = {
  youtube: "YT",
  spotify: "Spotify",
};

export default function App() {
  const ready = useObrReady();
  const isGM = useIsGM(ready);
  const playerId = usePlayerId(ready);
  const party = useParty(ready);
  const [room, patchRoom] = useRoomState(ready);
  const [inputValue, setInputValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [volume, setVolume] = useState(70);
  const [showDjPanel, setShowDjPanel] = useState(false);

  const isDJ = !!playerId && room.djIds.includes(playerId);
  const canControl = isGM || isDJ;
  const currentItem = room.currentIndex >= 0 ? room.queue[room.currentIndex] ?? null : null;

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
        "Unrecognized link. Use a YouTube video/playlist, or a Spotify track, album, playlist, or artist."
      );
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
    });
    setInputValue("");
    setAdding(false);
  }

  function playAt(index: number) {
    if (!canControl) return;
    patchRoom({ currentIndex: index, isPlaying: true });
  }

  function togglePlay() {
    if (!canControl) return;
    patchRoom({ isPlaying: !room.isPlaying });
  }

  function skip(delta: 1 | -1) {
    if (!canControl) return;
    if (room.queue.length === 0) return;
    const next = (room.currentIndex + delta + room.queue.length) % room.queue.length;
    patchRoom({ currentIndex: next, isPlaying: true });
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

  function clearQueue() {
    if (!canControl) return;
    // Dropping currentIndex back to -1 unmounts the embed entirely, so the
    // stage returns to its empty state rather than holding the last track.
    patchRoom({ queue: [], currentIndex: -1, isPlaying: false });
  }

  function handleEnded() {
    // Only the GM's client advances the shared queue, so multiple connected
    // players don't each independently skip the track on end.
    if (!isGM) return;
    if (room.queue.length === 0) return;
    const next = (room.currentIndex + 1) % room.queue.length;
    patchRoom({ currentIndex: next, isPlaying: true });
  }

  if (!ready) {
    return <div className="app app--loading">Connecting to Owlbear Rodeo…</div>;
  }

  return (
    <div className="app">
      <PlayerStage item={currentItem} isPlaying={room.isPlaying} volume={volume} onEnded={handleEnded} />

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
          className="clear"
          onClick={clearQueue}
          disabled={!canControl || room.queue.length === 0}
          title="Clear the queue and stop playback"
        >
          🗑
        </button>
        <label className="volume">
          🔊
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
        {isGM && (
          <button className="dj-toggle" onClick={() => setShowDjPanel((v) => !v)} title="Manage DJ privileges">
            🎧
          </button>
        )}
      </div>
      {!canControl && (
        <p className="hint">
          {room.djIds.length > 0
            ? "Only the GM and DJs can control playback — you'll hear what they play."
            : "Only the GM can control playback — you'll hear what they play."}
        </p>
      )}
      {!isGM && isDJ && <p className="hint hint--dj">You have DJ privileges 🎧</p>}

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

      {canControl ? (
        <div className="add-row">
          <input
            type="text"
            placeholder="Paste a YouTube or Spotify link…"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button onClick={handleAdd} disabled={adding || !inputValue.trim()}>
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
      ) : (
        <p className="hint">
          {room.djIds.length > 0
            ? "Only the GM and DJs can add songs."
            : "Only the GM can add songs — ask them for DJ privileges to add your own."}
        </p>
      )}
      {addError && <p className="error">{addError}</p>}

      <ul className="queue">
        {room.queue.map((item, index) => (
          <li key={item.id} className={index === room.currentIndex ? "queue-item queue-item--active" : "queue-item"}>
            <span className="badge">{SOURCE_LABEL[item.link.source]}</span>
            <button className="queue-title" onClick={() => playAt(index)} disabled={!canControl} title={item.url}>
              {item.title}
            </button>
            <button className="remove" onClick={() => removeAt(index)} disabled={!canControl} title="Remove">
              ✕
            </button>
          </li>
        ))}
        {room.queue.length === 0 && <li className="queue-empty">Nothing queued yet.</li>}
      </ul>
    </div>
  );
}
