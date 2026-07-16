import type {
  OnBufferData,
  OnLoadData,
  OnPlaybackStateChangedData,
  OnProgressData,
  OnVideoErrorData,
} from '../VideoVLCNativeComponent';

export interface ReactVideoVLCEvents {
  onEnd?: () => void;
  onBuffer?: (e: OnBufferData) => void;
  onError?: (e: OnVideoErrorData) => void;
  onLoad?: (e: OnLoadData) => void;
  onLoadStart?: () => void;
  onProgress?: (e: OnProgressData) => void;
  onPlaybackStateChanged?: (e: OnPlaybackStateChangedData) => void;
}
