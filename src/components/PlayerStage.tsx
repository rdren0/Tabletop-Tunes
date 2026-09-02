import { useEffect, useRef } from "react";
import { EchoState, initialEcho, observed, pushed, shouldMute } from "../lib/embedVolume";
import { hasGestured, registerUnmuteTarget } from "../lib/audioGestures";
import { loadScriptOnce } from "../lib/loadScript";
import { QueueItem, SYNC_TOLERANCE_SECONDS } from "../types";

interface PlayerStageProps {
  item: QueueItem | null;
  isPlaying: boolean;
  volume: number; // 0-100
  muted: boolean;
  /** Shared playback position: where the room was at `anchorAt`. */
  anchorPosition: number;
  anchorAt: number;
  /** Reports this client's playback position so controllers can re-anchor. */
  onTime?: (seconds: number) => void;
  /** Fired when playback had to start muted because the browser blocked audio. */
  onAutoMuted?: () => void;
  /**
   * The embed carries its own volume and mute controls, and a listener may
   * reach for those instead of ours. Reports what the player is actually doing
   * so the panel can follow it rather than contradict it.
   */
  onAudioChange?: (audio: { volume: number; muted: boolean }) => void;
  /**
   * Whether this client's player is genuinely running. The room wanting
   * playback and this browser allowing it are different things, and only the
   * player itself knows which.
   */
  onLocalPlaybackChange?: (playing: boolean) => void;
  /**
   * Whether the room started playback while this client was watching, rather
   * than this panel opening onto a room already mid-track. Decided in App,
   * because this component doesn't exist while the queue is empty and so can't
   * see the change that adding a first track makes.
   */
  roomStarted?: boolean;
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
  onAudioChange,
  onLocalPlaybackChange,
  roomStarted,
  canControl,
  onLocalTransport,
  onPlaylistLoaded,
  onEnded,
}: PlayerStageProps) {
  if (!item) {
    return (
      <div className="player-stage player-stage--empty">
        {/* A listener can't fix an empty queue, so telling them to paste a link
            reads as a broken instruction. Point at the GM instead. */}
        <p>
          {canControl
            ? "Queue is empty. Paste a YouTube link below."
            : "Nothing queued yet — the GM hasn't started any music."}
        </p>
      </div>
    );
  }

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
      onAudioChange={onAudioChange}
      onLocalPlaybackChange={onLocalPlaybackChange}
      roomStarted={roomStarted}
      canControl={canControl}
      onLocalTransport={onLocalTransport}
      onPlaylistLoaded={onPlaylistLoaded}
      onEnded={onEnded}
    />
  );
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
  onAudioChange,
  onLocalPlaybackChange,
  roomStarted,
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
  // What the embed made of the volume we last handed it. See lib/embedVolume:
  // its own number, not ours, is what a later read-back has to be judged
  // against.
  const echo = useRef<EchoState>(initialEcho);
  // The player has run past its last frame. There is nothing to sync to there,
  // and the room asking for this same track again is the queue coming back
  // round onto it.
  const ended = useRef(false);

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
  const onAudioChangeRef = useRef(onAudioChange);
  onAudioChangeRef.current = onAudioChange;
  const onLocalPlaybackChangeRef = useRef(onLocalPlaybackChange);
  onLocalPlaybackChangeRef.current = onLocalPlaybackChange;
  const wasRunning = useRef(false);
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
  // Loading a video can emit a PLAYING state on its own; that isn't someone
  // pressing play, so it must not be mirrored into room state.
  const lastLoadAt = useRef(0);
  // When playback was last genuinely running. A pause is only somebody's
  // decision if it interrupts real playback; otherwise it's the browser
  // refusing, and mirroring that would stop the whole room.
  const playingSince = useRef(0);
  const roomStartedRef = useRef(roomStarted);
  roomStartedRef.current = roomStarted;

  /** Playback may only begin from a deliberate act, not from simply being here. */
  function mayStart(): boolean {
    return hasGestured() || !!roomStartedRef.current;
  }

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
        pushVolume(player);
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
    // A player sitting past its last frame has nothing to sync to — seeking it
    // does nothing, and it is not going to start on its own. A fresh anchor
    // for the track it just finished is the room asking for that track again,
    // which is what a queue of one looping does, so load it over. Nothing else
    // covers this: the item is unchanged, so the load below sees no new key.
    if (ended.current && isPlaying) {
      loadCurrentItem();
      return;
    }
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

      // The embed's own speaker control writes straight to the player, where
      // nothing here would ever see it — leaving our slider and icon
      // describing a state the player isn't in, until the next change from
      // this side silently overrode the listener's. Read it back instead.
      // Deliberately above the early returns below, so it keeps working while
      // the room is paused.
      const livedVolume = player.getVolume?.();
      const livedMuted = player.isMuted?.();
      if (typeof livedVolume === "number" && typeof livedMuted === "boolean") {
        // Judged against the embed's echo of our own last push rather than
        // against our number: it does not keep what it is given, and at the
        // quiet end the difference is several steps. See lib/embedVolume.
        const lived = Math.round(livedVolume);
        const {
          state,
          moved: volumeMoved,
          muteMoved,
        } = observed(echo.current, lived, livedMuted, Date.now());
        echo.current = state;
        if (volumeMoved || muteMoved) {
          onAudioChangeRef.current?.({
            // A mute reported on its own says nothing about the volume, so
            // don't let the embed's rounding ride along with it.
            volume: volumeMoved ? lived : volumeRef.current,
            // Likewise the other way: a volume nudged on the embed's own
            // slider says nothing about mute, and taking its word for that
            // would unmute a listener who never asked.
            muted: muteMoved ? livedMuted : mutedRef.current,
          });
        }
      }

      // Keep watching rather than checking once after a play request: phones
      // block autoplay outright, and a client that was already sitting on the
      // popover can miss a single post-request check and stay silent.
      // The room is the source of truth: whatever the GM or a DJ set, every
      // client converges here, even one that missed the original transition.
      const state = player.getPlayerState?.();
      const playing = state === window.YT?.PlayerState.PLAYING;
      const buffering = state === window.YT?.PlayerState.BUFFERING;
      const ended = state === window.YT?.PlayerState.ENDED;

      // Buffering counts: it's on its way to sound, and treating it as stopped
      // would flash the "press play" prompt at the start of every track.
      const runningNow = playing || buffering;
      if (runningNow !== wasRunning.current) {
        wasRunning.current = runningNow;
        onLocalPlaybackChangeRef.current?.(runningNow);
      }

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
      if (!mayStart()) return;
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

  /**
   * Every route that sets the volume goes through here, so nothing reaches the
   * embed that the heartbeat could then read back and mistake for the listener
   * working YouTube's own speaker.
   */
  function pushVolume(player: YTPlayer) {
    player.setVolume?.(volumeRef.current);
    echo.current = pushed(Date.now());
  }

  /** Push the current audio settings at the player, whenever it's able to take them. */
  function applyAudio() {
    const player = playerRef.current;
    if (!player) return;
    pushVolume(player);
    // Zero has to be carried as mute, not as a number — see lib/embedVolume.
    if (shouldMute(volumeRef.current, mutedRef.current)) player.mute?.();
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

      // Built by hand rather than left to the API: `allow` is only read when
      // the frame loads, so delegating autoplay from onReady — after YouTube
      // has already navigated it — never granted the permission at all. The
      // ambience layers were fixed the same way; this one was missed.
      const frame = document.createElement("iframe");
      frame.title = "Tabletop Tunes player";
      frame.allow = "autoplay; encrypted-media";
      frame.width = "100%";
      frame.height = "100%";
      frame.style.border = "0";
      const params = new URLSearchParams({
        enablejsapi: "1",
        playsinline: "1",
        origin: window.location.origin,
      });
      // Only decides what the frame boots with — onReady loads or cues
      // whatever is current regardless. A playlist embed is addressed through
      // the videoseries path rather than by id.
      const { link } = itemRef.current;
      if (link.kind === "playlist") params.set("list", link.mediaId);
      const path = link.kind === "playlist" ? "videoseries" : link.mediaId;
      frame.src = `https://www.youtube.com/embed/${path}?${params}`;
      containerRef.current.appendChild(frame);

      playerRef.current = new window.YT.Player(frame, {
        events: {
          onReady: () => {
            readyRef.current = true;
            readyAt.current = Date.now();
            // Apply audio settings here too: the player ignores them until it
            // exists, so anything set before this point never reached it.
            applyAudio();
            loadCurrentItem();
          },
          onStateChange: (e) => {
            const YT = window.YT;
            if (!YT) return;
            if (e.data === YT.PlayerState.ENDED) {
              // A playlist item is many videos, and the embed walks them
              // itself. Only the end of the last one is the queue's turn
              // finishing; ending anywhere earlier would skip the rest of a
              // playlist after its first track.
              if (itemRef.current.link.kind === "playlist") {
                const ids = e.target.getPlaylist?.() ?? null;
                const index = e.target.getPlaylistIndex?.() ?? -1;
                if (ids && index > -1 && index < ids.length - 1) return;
              }
              ended.current = true;
              onEndedRef.current();
              return;
            }
            if (e.data === YT.PlayerState.PLAYING) {
              ended.current = false;
              userPaused.current = false;
              playingSince.current = Date.now();
              // A GM or DJ pressing YouTube's own play button is a real user
              // gesture — the one thing the API can't fake — so let it drive
              // the room rather than being overwritten a moment later.
              const fromLoad = Date.now() - lastLoadAt.current < 2000;
              if (canControlRef.current && !isPlayingRef.current && !fromLoad) {
                onLocalTransportRef.current?.(true);
              }
              return;
            }
            if (e.data === YT.PlayerState.PAUSED) {
              // Only a pause that interrupts playback which was genuinely
              // running counts as somebody's decision. Anything else is the
              // browser refusing, and mirroring that would stop the room.
              const wasRunning = playingSince.current > 0 && Date.now() - playingSince.current > 1000;
              playingSince.current = 0;
              const refused = Date.now() - lastPlayRequest.current < 2000;
              if (refused || !wasRunning || !isPlayingRef.current) return;
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
    // load*() begins playing immediately. When the room is paused — a listener
    // opening the panel before the GM has started anything — cue instead, so
    // nothing blares for a moment before the reconcile pauses it again.
    const shouldPlay = isPlayingRef.current && mayStart();
    lastLoadAt.current = Date.now();
    ended.current = false;
    if (link.kind === "playlist") {
      if (shouldPlay) player.loadPlaylist({ list: link.mediaId });
      else player.cuePlaylist?.({ list: link.mediaId });
    } else {
      if (shouldPlay) player.loadVideoById(link.mediaId);
      else player.cueVideoById?.(link.mediaId);
    }
    lastKeyRef.current = mediaKeyOf(itemRef.current);
    if (shouldPlay) requestPlay();
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
      // Finding a room already mid-track must not start audio on its own —
      // `mayStart` is what separates that from the room starting just now.
      // Note this can't lean on "is this the first run": the effect's first
      // run happens before the player is ready and returns above, so the guard
      // would instead fall on the first real change and swallow it.
      if (!mayStart()) return;
      // A fresh play from the room clears any local stop.
      userPaused.current = false;
      stalledTicks.current = 0;
      requestPlay();
    } else {
      playerRef.current?.pauseVideo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, roomStarted]);

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
