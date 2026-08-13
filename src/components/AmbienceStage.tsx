import { useEffect, useRef } from "react";
import { loadScriptOnce } from "../lib/loadScript";
import { hasGestured, registerGestureTarget, registerUnmuteTarget } from "../lib/audioGestures";
import { AmbienceStream } from "../types";

interface AmbienceStageProps {
  streams: AmbienceStream[];
  /**
   * This listener's own ambience level, applied on top of each stream's shared
   * mix level. Separate from the music volume so a listener can keep the beds
   * quiet under a track without touching either one's balance.
   */
  listenerVolume: number;
  muted: boolean;
}

/**
 * Runs a looping player per active ambience stream, so several sounds layer
 * under whatever the queue is playing. The players are audio-only in practice:
 * their iframes are parked in a 1px box rather than hidden with `display:none`,
 * which some browsers treat as a reason to refuse playback entirely.
 */
export function AmbienceStage({ streams, listenerVolume, muted }: AmbienceStageProps) {
  const active = streams.filter((stream) => stream.playing);
  // Layers already running when this panel opened are "found", not "started",
  // so they wait for a click. Ones switched on later began while the listener
  // was watching, and may sound straight away.
  const foundRunning = useRef<Set<string> | null>(null);
  if (foundRunning.current === null) {
    foundRunning.current = new Set(active.map((stream) => stream.id));
  }

  return (
    <div className="ambience-stage" aria-hidden>
      {active.map((stream) => (
        <AmbiencePlayer
          key={stream.id}
          stream={stream}
          listenerVolume={listenerVolume}
          muted={muted}
          startedHere={!foundRunning.current?.has(stream.id)}
        />
      ))}
    </div>
  );
}

function AmbiencePlayer({
  stream,
  listenerVolume,
  muted,
  startedHere,
}: {
  stream: AmbienceStream;
  listenerVolume: number;
  muted: boolean;
  startedHere: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  // A stream's own level is its place in the shared mix; the listener's
  // ambience volume scales the whole layer for them alone.
  const effectiveVolume = Math.round((stream.volume / 100) * listenerVolume);
  const volumeRef = useRef(effectiveVolume);
  volumeRef.current = effectiveVolume;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  // Only mounted while the stream is switched on, so it always wants to sound.
  const wantPlaying = useRef(true);

  /** Sound only from a deliberate act — a click here, or a layer started here. */
  function mayStart(): boolean {
    return startedHere || hasGestured();
  }

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
    // Never start merely because the panel opened onto a room that already had
    // layers running; wait for a click or a change during the session.
    if (!mayStart()) return;
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

      // Build the iframe by hand rather than letting the API generate it: the
      // `allow` attribute is only honoured at load time, so setting it later
      // (as onReady did) never delegated autoplay permission at all — which is
      // what kept Chrome refusing these layers.
      const frame = document.createElement("iframe");
      frame.allow = "autoplay; encrypted-media";
      frame.width = "100%";
      frame.height = "100%";
      frame.style.border = "0";
      const params = new URLSearchParams({
        enablejsapi: "1",
        playsinline: "1",
        controls: "0",
        // YouTube loops a single video only when it's given as a one-item list.
        loop: "1",
        playlist: stream.videoId,
        origin: window.location.origin,
      });
      frame.src = `https://www.youtube.com/embed/${stream.videoId}?${params}`;
      containerRef.current.appendChild(frame);

      playerRef.current = new window.YT.Player(frame, {
        events: {
          onReady: () => {
            // The iframe src already carries the video, so there's nothing to
            // load here — just set the levels and start if we're allowed to.
            const player = playerRef.current;
            applyAudio();
            if (wantPlaying.current && mayStart()) player?.playVideo();
            else player?.pauseVideo();
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
  }, [effectiveVolume, muted]);

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
