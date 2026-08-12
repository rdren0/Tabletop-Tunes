import { useEffect, useRef } from "react";
import { loadScriptOnce } from "../lib/loadScript";
import { QueueItem } from "../types";

interface PlayerStageProps {
  item: QueueItem | null;
  isPlaying: boolean;
  volume: number; // 0-100, YouTube only; Spotify embeds don't expose volume control
  muted: boolean; // likewise YouTube only
  onEnded: () => void;
}

/**
 * Mounts whichever embed matches the current queue item. Each source keeps
 * its player instance alive across play/pause toggles and only re-creates it
 * when the underlying media id actually changes, so scrubby state changes
 * (e.g. two clients patching room metadata close together) don't restart playback.
 */
export function PlayerStage({ item, isPlaying, volume, muted, onEnded }: PlayerStageProps) {
  if (!item) {
    return (
      <div className="player-stage player-stage--empty">
        <p>Queue is empty. Paste a YouTube or Spotify link below.</p>
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
    if (isPlayingRef.current) player.playVideo();
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

  // React to play/pause toggles.
  useEffect(() => {
    if (!readyRef.current) return;
    if (isPlaying) playerRef.current?.playVideo();
    else playerRef.current?.pauseVideo();
  }, [isPlaying]);

  // Volume and mute are per-client, never shared through room metadata.
  useEffect(() => {
    if (!readyRef.current) return;
    applyAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, muted]);

  // Deliberately childless in JSX: the embed lives in a plain DOM node created
  // in the effect above, outside React's control.
  return <div className="player-stage player-stage--youtube" ref={containerRef} />;
}

function SpotifyStage({
  item,
  isPlaying,
  onEnded,
}: Omit<PlayerStageProps, "volume" | "muted" | "item"> & { item: QueueItem }) {
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
