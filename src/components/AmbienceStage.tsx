import { useEffect, useRef } from "react";
import { loadScriptOnce } from "../lib/loadScript";
import { registerUnmuteTarget } from "../lib/audioGestures";
import { AmbienceStream } from "../types";

interface AmbienceStageProps {
  streams: AmbienceStream[];
  /** This listener's master level, applied on top of each stream's mix level. */
  masterVolume: number;
  muted: boolean;
}

/**
 * Runs a looping player per active ambience stream, so several sounds layer
 * under whatever the queue is playing. The players are audio-only in practice:
 * their iframes are parked in a 1px box rather than hidden with `display:none`,
 * which some browsers treat as a reason to refuse playback entirely.
 */
export function AmbienceStage({ streams, masterVolume, muted }: AmbienceStageProps) {
  const active = streams.filter((stream) => stream.playing);
  return (
    <div className="ambience-stage" aria-hidden>
      {active.map((stream) => (
        <AmbiencePlayer
          key={stream.id}
          stream={stream}
          masterVolume={masterVolume}
          muted={muted}
        />
      ))}
    </div>
  );
}

function AmbiencePlayer({
  stream,
  masterVolume,
  muted,
}: {
  stream: AmbienceStream;
  masterVolume: number;
  muted: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);

  // A stream's own level is relative to the mix; the listener's master volume
  // scales the whole thing.
  const effectiveVolume = Math.round((stream.volume / 100) * masterVolume);
  const volumeRef = useRef(effectiveVolume);
  volumeRef.current = effectiveVolume;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  function applyAudio() {
    const player = playerRef.current;
    if (!player) return;
    player.setVolume?.(volumeRef.current);
    if (mutedRef.current) player.mute?.();
    else player.unMute?.();
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
            readyRef.current = true;
            const frame = playerRef.current?.getIframe?.();
            if (frame) frame.allow = "autoplay; encrypted-media";
            applyAudio();
            playerRef.current?.loadVideoById(stream.videoId);
            playerRef.current?.playVideo();
          },
          onStateChange: (e) => {
            // Ambience loops forever rather than advancing anything.
            if (e.data === window.YT?.PlayerState.ENDED) {
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
      readyRef.current = false;
      containerRef.current?.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.videoId]);

  useEffect(() => {
    if (!readyRef.current) return;
    applyAudio();
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
        player.playVideo();
      }),
    []
  );

  // Keep nudging a stream the browser refused to start.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      const state = player.getPlayerState?.();
      if (state === window.YT?.PlayerState.PLAYING) return;
      if (state === window.YT?.PlayerState.BUFFERING) return;
      player.playVideo();
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  return <div className="ambience-player" ref={containerRef} />;
}
