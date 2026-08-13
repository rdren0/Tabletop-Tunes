import { useEffect, useRef } from "react";
import { loadScriptOnce } from "../lib/loadScript";
import { registerGestureTarget, registerUnmuteTarget } from "../lib/audioGestures";
import { AmbienceStream } from "../types";

interface AmbienceStageProps {
  streams: AmbienceStream[];
  /** This listener's master level, applied on top of each stream's mix level. */
  masterVolume: number;
  muted: boolean;
  /** Ambience follows the room's transport: pausing the track pauses the beds. */
  roomPlaying: boolean;
}

/**
 * Runs a looping player per active ambience stream, so several sounds layer
 * under whatever the queue is playing. The players are audio-only in practice:
 * their iframes are parked in a 1px box rather than hidden with `display:none`,
 * which some browsers treat as a reason to refuse playback entirely.
 */
export function AmbienceStage({ streams, masterVolume, muted, roomPlaying }: AmbienceStageProps) {
  const active = streams.filter((stream) => stream.playing);
  return (
    <div className="ambience-stage" aria-hidden>
      {active.map((stream) => (
        <AmbiencePlayer
          key={stream.id}
          stream={stream}
          masterVolume={masterVolume}
          muted={muted}
          roomPlaying={roomPlaying}
        />
      ))}
    </div>
  );
}

function AmbiencePlayer({
  stream,
  masterVolume,
  muted,
  roomPlaying,
}: {
  stream: AmbienceStream;
  masterVolume: number;
  muted: boolean;
  roomPlaying: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  // A stream's own level is relative to the mix; the listener's master volume
  // scales the whole thing.
  const effectiveVolume = Math.round((stream.volume / 100) * masterVolume);
  const volumeRef = useRef(effectiveVolume);
  volumeRef.current = effectiveVolume;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const wantPlaying = useRef(roomPlaying);
  wantPlaying.current = roomPlaying;

  function applyAudio() {
    const player = playerRef.current;
    if (!player) return;
    try {
      player.setVolume?.(volumeRef.current);
      if (mutedRef.current) player.mute?.();
      else player.unMute?.();
    } catch {
      // The player exists but isn't accepting calls yet; the heartbeat retries.
    }
  }

  /** Bring the player in line with what the room wants. */
  function reconcile() {
    const player = playerRef.current;
    if (!player) return;
    applyAudio();
    const state = player.getPlayerState?.();
    const playing = state === window.YT?.PlayerState.PLAYING;
    const buffering = state === window.YT?.PlayerState.BUFFERING;
    if (!wantPlaying.current) {
      if (playing || buffering) player.pauseVideo();
      return;
    }
    if (!playing && !buffering) player.playVideo();
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      await loadScriptOnce("https://www.youtube.com/iframe_api");
      await new Promise<void>((resolve) => {
        if (window.YT?.Player) return resolve();
        window.onYouTubeIframeAPIReady = () => resolve();
      });
      if (cancelled || !containerRef.current || !window.YT) return;

      const mount = document.createElement("div");
      containerRef.current.appendChild(mount);

      playerRef.current = new window.YT.Player(mount, {
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, controls: 0 },
        events: {
          onReady: () => {
            const frame = playerRef.current?.getIframe?.();
            if (frame) frame.allow = "autoplay; encrypted-media";
            playerRef.current?.loadVideoById(stream.videoId);
            applyAudio();
            if (wantPlaying.current) playerRef.current?.playVideo();
          },
          onStateChange: (e) => {
            // Ambience loops forever rather than advancing anything.
            if (e.data === window.YT?.PlayerState.ENDED && wantPlaying.current) {
              playerRef.current?.seekTo?.(0, true);
              playerRef.current?.playVideo();
            }
          },
        },
      });
    }

    init();
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        // Already torn down.
      }
      playerRef.current = null;
      containerRef.current?.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.videoId]);

  // React straight away to a level change or the room's transport.
  useEffect(() => {
    reconcile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveVolume, muted, roomPlaying]);

  // Join the room-wide unmute gesture, so one click restores every layer.
  useEffect(
    () =>
      registerUnmuteTarget(() => {
        const player = playerRef.current;
        if (!player) return;
        player.unMute?.();
        player.setVolume?.(volumeRef.current);
        if (wantPlaying.current) player.playVideo();
      }),
    []
  );

  // Ambience has no visible surface to click, so a listener can never grant it
  // a gesture directly. Any click in the popover is one — use it to start the
  // layers a browser refused to autoplay.
  useEffect(() => registerGestureTarget(reconcile), []);

  // Self-healing: covers a player that wasn't ready when settings changed.
  useEffect(() => {
    const timer = window.setInterval(reconcile, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="ambience-player" ref={containerRef} />;
}
