export {};

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          videoId?: string;
          // The API writes these onto the iframe it generates; "100%" lets the
          // styled wrapper drive the size instead of YouTube's 640x390 default.
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, unknown>;
          events?: {
            onReady?: (event: { target: YTPlayer }) => void;
            onStateChange?: (event: { data: number; target: YTPlayer }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayer;
      PlayerState: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        CUED: number;
      };
    };

    onSpotifyIframeApiReady?: (IFrameAPI: SpotifyIFrameAPI) => void;
  }

  interface YTPlayer {
    playVideo(): void;
    pauseVideo(): void;
    loadVideoById(id: string): void;
    loadPlaylist(options: { list: string }): void;
    getIframe?(): HTMLIFrameElement | null;
    getPlayerState?(): number;
    setVolume?(volume: number): void;
    mute?(): void;
    unMute?(): void;
    destroy(): void;
  }

  interface SpotifyEmbedController {
    loadUri(uri: string): void;
    play(): void;
    pause(): void;
    addListener(
      event: "playback_update",
      cb: (e: { data: { isPaused: boolean; position: number; duration: number } }) => void
    ): void;
    destroy(): void;
  }

  interface SpotifyIFrameAPI {
    createController(
      element: HTMLElement,
      options: { uri: string; width?: string | number; height?: string | number },
      callback: (controller: SpotifyEmbedController) => void
    ): void;
  }
}
