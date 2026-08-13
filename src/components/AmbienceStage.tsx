import { useEffect, useRef, useState } from "react";
import { loadScriptOnce } from "../lib/loadScript";
import { hasGestured, registerGestureTarget, registerUnmuteTarget } from "../lib/audioGestures";
import { autoplayAllowed } from "../lib/autoplayProbe";
import { AmbienceStream } from "../types";

interface AmbienceLayerProps {
  stream: AmbienceStream;
  /**
   * This listener's own ambience level, applied on top of each stream's shared
   * mix level. Separate from the music volume so a listener can keep the beds
   * quiet under a track without touching either one's balance.
   */
  listenerVolume: number;
  muted: boolean;
  /** False for a layer that was already running when this panel opened. */
  startedHere: boolean;
  canControl: boolean;
  onToggle: () => void;
}

/**
 * One ambience layer: its transport control and the player behind it, in the
 * same slot. The player is normally a 1px sliver, but when a browser refuses
 * to start it the embed is cropped down to its own play button and shown in
 * place of the toggle — a real click on the iframe being the only thing a
 * browser accepts as permission to start audio.
 */
export function AmbienceLayer({
  stream,
  listenerVolume,
  muted,
  startedHere,
  canControl,
  onToggle,
}: AmbienceLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [needsClick, setNeedsClick] = useState(false);
  const [starting, setStarting] = useState(false);
  const refusedTicks = useRef(0);
  // null until the probe answers; true means this browser won't start audio
  // on its own, so offer the fallback at once rather than retrying in silence.
  const autoplayBlocked = useRef<boolean | null>(null);
  useEffect(() => {
    autoplayAllowed().then((ok) => {
      autoplayBlocked.current = !ok;
    });
  }, []);

  const effectiveVolume = Math.round((stream.volume / 100) * listenerVolume);
  const volumeRef = useRef(effectiveVolume);
  volumeRef.current = effectiveVolume;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const wantPlaying = useRef(stream.playing);
  wantPlaying.current = stream.playing;

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
      // Not accepting calls yet; the heartbeat retries.
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
      refusedTicks.current = 0;
      setNeedsClick(false);
      setStarting(false);
      if (playing || buffering) player.pauseVideo();
      return;
    }
    if (!mayStart()) return;

    if (playing || buffering) {
      refusedTicks.current = 0;
      setNeedsClick(false);
      setStarting(false);
      return;
    }

    player.playVideo();
    refusedTicks.current += 1;
    // A browser that already told us it won't autoplay isn't going to change
    // its mind, so don't make anyone watch a spinner for it.
    const hopeless = autoplayBlocked.current === true && !hasGestured();
    if (hopeless || refusedTicks.current >= 2) {
      setNeedsClick(true);
      setStarting(false);
    } else {
      setStarting(true);
    }
  }

  // Create the player only while the layer is switched on.
  useEffect(() => {
    if (!stream.playing) return;
    let cancelled = false;

    async function init() {
      await loadScriptOnce("https://www.youtube.com/iframe_api");
      await new Promise<void>((resolve) => {
        if (window.YT?.Player) return resolve();
        window.onYouTubeIframeAPIReady = () => resolve();
      });
      if (cancelled || !containerRef.current || !window.YT) return;

      // Built by hand because `allow` is only honoured at load time — setting
      // it afterwards never delegates autoplay permission at all.
      const frame = document.createElement("iframe");
      frame.allow = "autoplay; encrypted-media";
      frame.width = "100%";
      frame.height = "100%";
      frame.style.border = "0";
      const params = new URLSearchParams({
        enablejsapi: "1",
        playsinline: "1",
        controls: "1",
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
            applyAudio();
            if (wantPlaying.current && mayStart()) {
              playerRef.current?.playVideo();
              setStarting(true);
            } else {
              playerRef.current?.pauseVideo();
            }
          },
          onStateChange: (e) => {
            if (e.data === window.YT?.PlayerState.PLAYING) {
              setNeedsClick(false);
              setStarting(false);
              refusedTicks.current = 0;
            }
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
      setNeedsClick(false);
      setStarting(false);
      refusedTicks.current = 0;
      containerRef.current?.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.videoId, stream.playing]);

  useEffect(() => {
    reconcile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveVolume, muted, stream.playing]);

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

  // Ambience has no surface of its own to click, so any click in the popover
  // stands in for one.
  useEffect(() => registerGestureTarget(reconcile), []);

  useEffect(() => {
    const timer = window.setInterval(reconcile, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className="amb-slot">
      {/* Always mounted while playing; only visible when it has to be clicked. */}
      <span
        className={needsClick ? "ambience-player ambience-player--peephole" : "ambience-player"}
        title={needsClick ? `Start ${stream.title}` : undefined}
      >
        <span className="ambience-player-frame" ref={containerRef} />
      </span>

      {!needsClick &&
        (canControl ? (
          <button
            className={stream.playing ? "amb-toggle amb-toggle--on" : "amb-toggle"}
            onClick={onToggle}
            title={stream.playing ? "Stop" : "Play"}
          >
            {starting ? <span className="amb-spinner" /> : stream.playing ? "◼" : "▶"}
          </button>
        ) : (
          starting && <span className="amb-spinner" />
        ))}
    </span>
  );
}
