import { useEffect, useRef, useState } from "react";
import { loadScriptOnce } from "../lib/loadScript";
import { QueueItem, SYNC_TOLERANCE_SECONDS } from "../types";
import { SPOTIFY_ENABLED } from "../config";

interface PlayerStageProps {
  item: QueueItem | null;
  isPlaying: boolean;
  volume: number; // 0-100, YouTube only; Spotify embeds don't expose volume control
  muted: boolean; // likewise YouTube only
  /** Shared playback position: where the room was at `anchorAt`. */
  anchorPosition: number;
  anchorAt: number;
  /** Reports this client's playback position so controllers can re-anchor. */
  onTime?: (seconds: number) => void;
  /** Video ids discovered inside a YouTube playlist, once it has loaded. */
  onPlaylistLoaded?: (videoIds: string[]) => void;
  onEnded: () => void;
}

/**
 * Mounts whichever embed matches the current queue item. Each source keeps
 * its player instance alive across play/pause toggles and only re-creates it
 * when the underlying media id actually changes, so scrubby state changes
 * (e.g. two clients patching room metadata close together) don't restart playback.
 */
export function PlayerStage({
  item,
  isPlaying,
  volume,
  muted,
  anchorPosition,
  anchorAt,
  onTime,
  onPlaylistLoaded,
  onEnded,
}: PlayerStageProps) {
  if (!item) {
    return (
      <div className="player-stage player-stage--empty">
        <p>
          Queue is empty. Paste a YouTube{SPOTIFY_ENABLED ? " or Spotify" : ""} link below.
        </p>
      </div>
    );
  }

  if (item.link.source === "youtube") {
    return (
      <YouTubeStage
        key="youtube-stage"
        item={item}
        isPlaying={isPlaying}
        volume={volume}
        muted={muted}
        anchorPosition={anchorPosition}
        anchorAt={anchorAt}
        onTime={onTime}
        onPlaylistLoaded={onPlaylistLoaded}
        onEnded={onEnded}
      />
    );
  }

  return <SpotifyStage key="spotify-stage" item={item} isPlaying={isPlaying} onEnded={onEnded} />;
}

/** Identifies the underlying media, so re-renders only reload on a real change. */
function mediaKeyOf(item: QueueItem): string {
  return item.link.kind === "playlist" ? `pl:${item.link.mediaId}` : `v:${item.link.mediaId}`;
}

function YouTubeStage({
  item,
  isPlaying,
  volume,
  muted,
  anchorPosition,
  anchorAt,
  onTime,
  onPlaylistLoaded,
  onEnded,
}: Omit<PlayerStageProps, "item"> & { item: QueueItem }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const itemRef = useRef(item);
  itemRef.current = item;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Browsers refuse programmatic playback until the listener has interacted
  // with the page, so a client that just opened the popover can stay silent
  // while everyone else is hearing the track. Detect that and offer a tap.
  const [needsGesture, setNeedsGesture] = useState(false);

  function requestPlay() {
    const player = playerRef.current;
    if (!player) return;
    player.playVideo();
    window.setTimeout(() => {
      if (!isPlayingRef.current || !playerRef.current) return;
      const state = playerRef.current.getPlayerState?.();
      if (state !== window.YT?.PlayerState.PLAYING) setNeedsGesture(true);
    }, 1500);
  }

  const anchorPositionRef = useRef(anchorPosition);
  anchorPositionRef.current = anchorPosition;
  const anchorAtRef = useRef(anchorAt);
  anchorAtRef.current = anchorAt;
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
  const onPlaylistLoadedRef = useRef(onPlaylistLoaded);
  onPlaylistLoadedRef.current = onPlaylistLoaded;
  const lastPlaylistRef = useRef("");

  /** Where the room expects this client to be, in seconds into the track. */
  function expectedPosition(): number | null {
    if (!anchorAtRef.current) return null;
    if (!isPlayingRef.current) return anchorPositionRef.current;
    // anchorAt comes from another machine's clock. A badly-set clock would
    // produce a nonsense elapsed time, so ignore it rather than yanking this
    // listener to a bogus position.
    const elapsed = (Date.now() - anchorAtRef.current) / 1000;
    if (elapsed < 0 || elapsed > 3600) return null;
    return anchorPositionRef.current + elapsed;
  }

  /** Seek only when drift is bad enough to be worth the rebuffer. */
  function syncToAnchor() {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    const target = expectedPosition();
    if (target === null) return;
    const duration = player.getDuration?.() ?? 0;
    if (duration > 0 && target >= duration - 1) return;
    const actual = player.getCurrentTime?.() ?? 0;
    if (Math.abs(actual - target) > SYNC_TOLERANCE_SECONDS) {
      player.seekTo?.(target, true);
    }
  }

  // Correct as soon as a new anchor arrives, which also covers late joiners.
  useEffect(() => {
    if (!readyRef.current) return;
    syncToAnchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorPosition, anchorAt, isPlaying]);

  // Heartbeat: report position, correct slow drift, and surface playlist contents.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;

      onTimeRef.current?.(player.getCurrentTime?.() ?? 0);
      if (isPlayingRef.current) syncToAnchor();

      if (itemRef.current.link.kind === "playlist") {
        const ids = player.getPlaylist?.() ?? null;
        const key = ids?.join(",") ?? "";
        if (key && key !== lastPlaylistRef.current) {
          lastPlaylistRef.current = key;
          onPlaylistLoadedRef.current?.(ids as string[]);
        }
      }
    }, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Push the current audio settings at the player, whenever it's able to take them. */
  function applyAudio() {
    const player = playerRef.current;
    if (!player) return;
    player.setVolume?.(volumeRef.current);
    if (mutedRef.current) player.mute?.();
    else player.unMute?.();
  }

  // Create the player once per mount, load the current item once it's ready.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      await loadScriptOnce("https://www.youtube.com/iframe_api");
      await new Promise<void>((resolve) => {
        if (window.YT?.Player) return resolve();
        window.onYouTubeIframeAPIReady = () => resolve();
      });
      if (cancelled || !containerRef.current || !window.YT) return;

      // The YouTube API replaces the element it's given. Hand it a detached
      // child React never rendered, so React isn't left trying to remove a
      // node that no longer exists (which throws and blanks the whole app).
      const mount = document.createElement("div");
      containerRef.current.appendChild(mount);

      playerRef.current = new window.YT.Player(mount, {
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1 },
        events: {
          onReady: () => {
            readyRef.current = true;
            // A nested iframe only gets autoplay permission if every ancestor
            // delegates it; harmless when the host frame doesn't.
            const frame = playerRef.current?.getIframe?.();
            if (frame) frame.allow = "autoplay; encrypted-media";
            // Apply audio settings here too: the player ignores them until it
            // exists, so anything set before this point never reached it.
            applyAudio();
            loadCurrentItem();
          },
          onStateChange: (e) => {
            if (e.data === window.YT?.PlayerState.PLAYING) setNeedsGesture(false);
            if (e.data === window.YT?.PlayerState.ENDED) onEndedRef.current();
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
        // The API throws if its iframe is already gone; nothing to clean up.
      }
      playerRef.current = null;
      readyRef.current = false;
      containerRef.current?.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Always load whatever is selected *now*: onReady fires long after mount, so
  // reading `item` from that closure would replay the track that was current
  // when the player was created, not the one the user just clicked.
  function loadCurrentItem() {
    const player = playerRef.current;
    if (!player) return;
    const { link } = itemRef.current;
    if (link.kind === "playlist") {
      player.loadPlaylist({ list: link.mediaId });
    } else {
      player.loadVideoById(link.mediaId);
    }
    lastKeyRef.current = mediaKeyOf(itemRef.current);
    // load*() normally starts playback on its own, but a player that was
    // paused can come back cued instead — so ask explicitly.
    if (isPlayingRef.current) requestPlay();
  }

  // React to the queue item changing.
  const mediaKey = mediaKeyOf(item);
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!readyRef.current) return;
    if (lastKeyRef.current === mediaKey) return;
    loadCurrentItem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey]);

  // React to play/pause toggles the GM or a DJ made for the whole room.
  useEffect(() => {
    if (!readyRef.current) return;
    if (isPlaying) {
      requestPlay();
    } else {
      setNeedsGesture(false);
      playerRef.current?.pauseVideo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // Volume and mute are per-client, never shared through room metadata.
  useEffect(() => {
    if (!readyRef.current) return;
    applyAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, muted]);

  // The mount node is deliberately childless in JSX: the embed lives in a plain
  // DOM node created in the effect above, outside React's control. The overlay
  // is a sibling of that node, so React never has to reconcile around it.
  return (
    <div className="player-stage player-stage--youtube">
      <div className="player-mount" ref={containerRef} />
      {needsGesture && (
        <button
          className="tap-to-play"
          onClick={() => {
            setNeedsGesture(false);
            playerRef.current?.playVideo();
          }}
        >
          ▶ Tap to start audio
        </button>
      )}
    </div>
  );
}

function SpotifyStage({
  item,
  isPlaying,
  onEnded,
}: Omit<
  PlayerStageProps,
  "volume" | "muted" | "item" | "anchorPosition" | "anchorAt" | "onTime" | "onPlaylistLoaded"
> & { item: QueueItem }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SpotifyEmbedController | null>(null);
  const readyRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const lastNearEndRef = useRef(false);

  const uri = `spotify:${item.link.kind}:${item.link.mediaId}`;

  useEffect(() => {
    let cancelled = false;

    async function init() {
      await loadScriptOnce("https://open.spotify.com/embed/iframe-api/v1");
      const IFrameAPI = await new Promise<SpotifyIFrameAPI>((resolve) => {
        window.onSpotifyIframeApiReady = (api) => resolve(api);
      });
      if (cancelled || !containerRef.current) return;

      // Same story as YouTube: Spotify swaps out the element it's handed, so
      // it gets a detached node instead of one React is tracking.
      const mount = document.createElement("div");
      containerRef.current.appendChild(mount);

      IFrameAPI.createController(mount, { uri, width: "100%", height: 152 }, (controller) => {
        if (cancelled) return;
        controllerRef.current = controller;
        readyRef.current = true;
        controller.addListener("playback_update", (e) => {
          const { isPaused, position, duration } = e.data;
          const nearEnd = duration > 0 && duration - position < 750;
          if (isPaused && nearEnd && !lastNearEndRef.current) {
            onEndedRef.current();
          }
          lastNearEndRef.current = nearEnd;
        });
        if (isPlaying) controller.play();
      });
    }

    init();
    return () => {
      cancelled = true;
      try {
        controllerRef.current?.destroy();
      } catch {
        // Controller already torn down; safe to ignore.
      }
      controllerRef.current = null;
      readyRef.current = false;
      lastNearEndRef.current = false;
      containerRef.current?.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  useEffect(() => {
    if (!readyRef.current) return;
    if (isPlaying) controllerRef.current?.play();
    else controllerRef.current?.pause();
  }, [isPlaying]);

  return <div className="player-stage" ref={containerRef} />;
}
