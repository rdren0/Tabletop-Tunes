import { useEffect, useRef } from "react";
import { registerUnmuteTarget } from "../lib/audioGestures";
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
  /** Fired when playback had to start muted because the browser blocked audio. */
  onAutoMuted?: () => void;
  /** Whether this client may write playback state for the whole room. */
  canControl?: boolean;
  /** A GM/DJ used the player's own controls; mirror it into room state. */
  onLocalTransport?: (playing: boolean) => void;
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
  onAutoMuted,
  canControl,
  onLocalTransport,
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
        onAutoMuted={onAutoMuted}
        canControl={canControl}
        onLocalTransport={onLocalTransport}
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
  onAutoMuted,
  canControl,
  onLocalTransport,
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

  function requestPlay() {
    lastPlayRequest.current = Date.now();
    playerRef.current?.playVideo();
  }

  const anchorPositionRef = useRef(anchorPosition);
  anchorPositionRef.current = anchorPosition;
  const anchorAtRef = useRef(anchorAt);
  anchorAtRef.current = anchorAt;
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
  const onAutoMutedRef = useRef(onAutoMuted);
  onAutoMutedRef.current = onAutoMuted;
  const onPlaylistLoadedRef = useRef(onPlaylistLoaded);
  onPlaylistLoadedRef.current = onPlaylistLoaded;
  const lastPlaylistRef = useRef("");
  // Consecutive heartbeats where the room wanted playback but this client
  // wasn't playing — one retry before bothering the listener for a tap.
  const stalledTicks = useRef(0);
  // A just-created player sits in UNSTARTED for a moment; without a grace
  // period that reads as a refusal and flashes the tap prompt on every load.
  const readyAt = useRef(0);
  // Once the listener has deliberately unmuted, never auto-mute them again —
  // otherwise the fallback and the listener fight each other.
  const userUnmuted = useRef(false);
  // A listener may stop their own audio. Once they have, stop trying to
  // restart them — but they still can't start playback the room hasn't.
  const userPaused = useRef(false);
  // When we last asked the player to play, so a pause that lands right after
  // reads as the browser refusing rather than the listener choosing.
  const lastPlayRequest = useRef(0);
  const canControlRef = useRef(canControl);
  canControlRef.current = canControl;
  const onLocalTransportRef = useRef(onLocalTransport);
  onLocalTransportRef.current = onLocalTransport;

  // Join the room-wide unmute gesture so one click restores every player.
  useEffect(
    () =>
      registerUnmuteTarget(() => {
        const player = playerRef.current;
        if (!player) return;
        userUnmuted.current = true;
        stalledTicks.current = 0;
        player.unMute?.();
        player.setVolume?.(volumeRef.current);
        if (!isPlayingRef.current) return;
        player.playVideo();
        // Unmuting can make the browser pause a moment later, since the API
        // call reaches YouTube's frame without the user activation the tap
        // carried. Nudge it a few times; on desktop that usually recovers.
        [300, 900, 1800].forEach((delay) =>
          window.setTimeout(() => {
            if (!isPlayingRef.current) return;
            const p = playerRef.current;
            if (!p) return;
            if (p.getPlayerState?.() !== window.YT?.PlayerState.PLAYING) p.playVideo();
          }, delay)
        );
      }),
    []
  );

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
    // A listener who stopped their own audio isn't drifting, they're parked.
    // Chasing the room's anchor would seek them every couple of seconds.
    if (userPaused.current) return;
    // Only a player that is actually running can drift. Seeking a paused or
    // cued one just reloads the frame, which reads as the picture flickering.
    const state = player.getPlayerState?.();
    if (state !== window.YT?.PlayerState.PLAYING && state !== window.YT?.PlayerState.BUFFERING) {
      return;
    }
    const target = expectedPosition();
    if (target === null) return;
    // A duration of 0 means the video hasn't loaded yet; seeking now would
    // land somewhere meaningless.
    const duration = player.getDuration?.() ?? 0;
    if (duration <= 0 || target >= duration - 1) return;
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

      // Keep watching rather than checking once after a play request: phones
      // block autoplay outright, and a client that was already sitting on the
      // popover can miss a single post-request check and stay silent.
      // The room is the source of truth: whatever the GM or a DJ set, every
      // client converges here, even one that missed the original transition.
      const state = player.getPlayerState?.();
      const playing = state === window.YT?.PlayerState.PLAYING;
      const buffering = state === window.YT?.PlayerState.BUFFERING;
      const ended = state === window.YT?.PlayerState.ENDED;

      if (!isPlayingRef.current) {
        // Nobody may start playback the room hasn't, so a paused room is
        // enforced on every client — including one that hit YouTube's own
        // play button.
        stalledTicks.current = 0;
        if (playing) player.pauseVideo();
        return;
      }

      // A listener who stopped their own audio stays stopped; they simply
      // can't start it again until the room does.
      if (userPaused.current) {
        stalledTicks.current = 0;
        return;
      }

      if (playing || buffering || ended) {
        stalledTicks.current = 0;
        return;
      }

      // The room wants playback but this client isn't playing. Retry first —
      // that recovers the ordinary cases silently.
      if (Date.now() - readyAt.current < 3000) return;
      stalledTicks.current += 1;
      if (stalledTicks.current <= 2) {
        player.playVideo();
        return;
      }
      // Still refused, which is what phones always do and what an incognito
      // window does with no media engagement history. Muted playback is
      // permitted everywhere, so start in sync without sound and let the
      // listener unmute with the speaker button already in the transport.
      if (stalledTicks.current === 3 && !userUnmuted.current) {
        player.mute?.();
        player.playVideo();
        onAutoMutedRef.current?.();
      }

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
            readyAt.current = Date.now();
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
            const YT = window.YT;
            if (!YT) return;
            if (e.data === YT.PlayerState.ENDED) {
              onEndedRef.current();
              return;
            }
            if (e.data === YT.PlayerState.PLAYING) {
              userPaused.current = false;
              // A GM or DJ pressing YouTube's own play button is a real user
              // gesture — the one thing the API can't fake — so let it drive
              // the room rather than being overwritten a moment later.
              if (canControlRef.current && !isPlayingRef.current) {
                onLocalTransportRef.current?.(true);
              }
              return;
            }
            if (e.data === YT.PlayerState.PAUSED) {
              // A pause immediately after we asked to play is the browser
              // refusing, not a decision by whoever is watching.
              const refused = Date.now() - lastPlayRequest.current < 2000;
              if (refused || !isPlayingRef.current) return;
              if (canControlRef.current) onLocalTransportRef.current?.(false);
              else userPaused.current = true;
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
    // A fresh play from the room clears any local stop.
    if (isPlaying) {
      userPaused.current = false;
      stalledTicks.current = 0;
      requestPlay();
    } else {
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
  // DOM node created in the effect above, outside React's control.
  return (
    <div className="player-stage player-stage--youtube">
      <div className="player-mount" ref={containerRef} />
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
