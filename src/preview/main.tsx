import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "../App";
import { preview } from "./obrMock";
import { EMPTY_ROOM_STATE, ROOM_METADATA_KEY, RoomState } from "../types";
import "../index.css";
import "./preview.css";

/** Enough of a room to exercise the queue, the active row and a request. */
const SEED: RoomState = {
  ...EMPTY_ROOM_STATE,
  queue: [
    {
      id: "q1",
      url: "https://www.youtube.com/watch?v=x",
      title: "3 Hour Dark Gothic Orchestral Music | Curse of Strahd",
      link: { source: "youtube", kind: "video", mediaId: "dQw4w9WgXcQ" },
    },
    {
      id: "q2",
      url: "https://www.youtube.com/watch?v=y",
      title: "Tavern Ambience — Lute and Laughter",
      link: { source: "youtube", kind: "video", mediaId: "5qap5aO4i9A" },
    },
  ],
  currentIndex: 0,
  isPlaying: true,
  djIds: ["player-bo"],
  requests: [
    {
      id: "r1",
      url: "https://www.youtube.com/watch?v=z",
      title: "Battle Theme — Brass and Drums",
      link: { source: "youtube", kind: "video", mediaId: "abc123" },
      requestedById: "player-ana",
      requestedByName: "Ana",
      status: "pending",
    },
  ],
  anchorPosition: 0,
  anchorAt: Date.now(),
  updatedAt: Date.now(),
};

preview.seedRoom({ [ROOM_METADATA_KEY]: SEED });

function Harness() {
  const [mode, setMode] = useState<"LIGHT" | "DARK">("DARK");
  const [role, setRole] = useState<"GM" | "PLAYER">("GM");
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => preview.setTheme(mode), [mode]);
  useEffect(() => preview.setRole(role), [role]);
  useEffect(() => {
    const onHeight = (e: Event) => setHeight((e as CustomEvent<number>).detail);
    window.addEventListener("preview:height", onHeight);
    return () => window.removeEventListener("preview:height", onHeight);
  }, []);

  return (
    <div className="harness">
      <div className="harness-bar">
        <strong>Tabletop Tunes preview</strong>
        <label>
          Theme
          <select value={mode} onChange={(e) => setMode(e.target.value as "LIGHT" | "DARK")}>
            <option value="DARK">Dark</option>
            <option value="LIGHT">Light</option>
          </select>
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as "GM" | "PLAYER")}>
            <option value="GM">GM</option>
            <option value="PLAYER">Player (listener)</option>
          </select>
        </label>
        <span className="harness-note">
          popover height: {height === null ? "—" : `${height}px`}
        </span>
      </div>
      {/* 380px is the manifest's popover width, so wrapping matches reality. */}
      <div className="harness-frame">
        <App />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>
);
