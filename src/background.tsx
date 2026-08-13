import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { useIsGM, useObrReady, useParty, usePlayerId, useRoomState } from "./lib/useOwlbear";
import { PlayerStage } from "./components/PlayerStage";
import { AmbienceStage } from "./components/AmbienceStage";
import { LocalAudio, readLocalAudio, subscribeLocalAudio } from "./lib/localAudio";
import { writeFramePlaylist } from "./lib/framePlaylist";
import "./index.css";

/**
 * Owlbear keeps this page alive for as long as the extension is enabled, while
 * the popover only exists while it's open. Playback therefore lives here, so a
 * listener hears the room whether or not they've opened the panel. The popover
 * is purely the control surface and writes its intent to room metadata.
 */
function Background() {
  const ready = useObrReady();
  const isGM = useIsGM(ready);
  const playerId = usePlayerId(ready);
  const party = useParty(ready);
  const [room, patchRoom] = useRoomState(ready);
  const [audio, setAudio] = useState<LocalAudio>(readLocalAudio);
  const positionRef = useRef(0);

  // The popover owns the volume and mute controls; pick up its changes.
  useEffect(() => subscribeLocalAudio(setAudio), []);

  const isDJ = !!playerId && room.djIds.includes(playerId);
  const currentItem = room.currentIndex >= 0 ? room.queue[room.currentIndex] ?? null : null;

  /** Exactly one client advances the queue; see the same rule in App. */
  function isAdvancer(): boolean {
    if (isGM) return true;
    if (party.some((p) => p.role === "GM")) return false;
    if (!playerId || !isDJ) return false;
    const connectedDjs = [playerId, ...party.map((p) => p.id)]
      .filter((id) => room.djIds.includes(id))
      .sort();
    return connectedDjs[0] === playerId;
  }

  function handleEnded() {
    if (!isAdvancer()) return;
    if (room.queue.length === 0) return;
    const next = (room.currentIndex + 1) % room.queue.length;
    patchRoom({ currentIndex: next, isPlaying: true, anchorPosition: 0, anchorAt: Date.now() });
  }

  // The popover flips isPlaying without touching the anchor, because only this
  // side knows the position. Freeze it on pause, and restart the clock (not the
  // position) on resume, so a pause doesn't count against playback time.
  const wasPlaying = useRef(room.isPlaying);
  useEffect(() => {
    if (wasPlaying.current === room.isPlaying) return;
    wasPlaying.current = room.isPlaying;
    if (!isAdvancer()) return;
    if (room.isPlaying) patchRoom({ anchorAt: Date.now() });
    else patchRoom({ anchorPosition: positionRef.current, anchorAt: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.isPlaying]);

  // Republish the shared position so long tracks don't drift apart.
  useEffect(() => {
    if (!room.isPlaying) return;
    const timer = window.setInterval(() => {
      if (!isAdvancer()) return;
      patchRoom({ anchorPosition: positionRef.current, anchorAt: Date.now() });
    }, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.isPlaying, room.currentIndex, isGM, isDJ, playerId, party.length]);

  if (!ready) return null;

  return (
    <div className="background-stage">
      <PlayerStage
        item={currentItem}
        isPlaying={room.isPlaying}
        volume={audio.volume}
        muted={audio.muted}
        anchorPosition={room.anchorPosition}
        anchorAt={room.anchorAt}
        onTime={(seconds) => {
          positionRef.current = seconds;
        }}
        canControl={isGM || isDJ}
        onLocalTransport={(playing) => {
          if (!isGM && !isDJ) return;
          patchRoom({
            isPlaying: playing,
            anchorPosition: positionRef.current,
            anchorAt: Date.now(),
          });
        }}
        onPlaylistLoaded={writeFramePlaylist}
        onEnded={handleEnded}
      />
      <AmbienceStage streams={room.ambience} masterVolume={audio.volume} muted={audio.muted} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Background />
  </React.StrictMode>
);
