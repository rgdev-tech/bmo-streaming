import type { HostComponent, ViewProps } from 'react-native';
import type { Float, Int32, DirectEventHandler } from 'react-native/Libraries/Types/CodegenTypesNamespace';
import codegenNativeCommands from 'react-native/Libraries/Utilities/codegenNativeCommands';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

type Headers = ReadonlyArray<
  Readonly<{
    key: string;
    value: string;
  }>
>;

export type VideoSrc = Readonly<{
  uri?: string;
  requestHeaders?: Headers;
  startPosition?: Float;
  minLoadRetryCount?: Int32; // Android
  mediaOptions?: string[]; // media vlc options
}>;

export type OnLoadData = Readonly<{
  currentTime: Float;
  duration: Float;
  naturalSize: Readonly<{
    width: Float;
    height: Float;
    orientation: 'landscape' | 'portrait' | 'square';
  }>;
  videoTracks: {
    id: Int32;
    selected: boolean;
    title?: string;
    language?: string;
  }[];
  audioTracks: {
    id: Int32;
    selected: boolean;
    title?: string;
    language?: string;
  }[];
  textTracks: {
    id: Int32;
    selected: boolean;
    title?: string;
    language?: string;
  }[];
}>;

export type OnVideoErrorData = Readonly<{
  error: Readonly<{
    errorString: string;
    errorCode: Int32;
  }>;
}>;

export type OnBufferData = Readonly<{ isBuffering: boolean }>;

export type OnProgressData = Readonly<{
  currentTime: Float;
  seekableDuration: Float;
  progress: Float;
}>;

export type OnPlaybackStateChangedData = Readonly<{
  isPlaying: boolean;
  isSeeking: boolean;
}>;

export interface NativeProps extends ViewProps {
  src?: VideoSrc;
  repeat?: boolean;
  resizeMode?: string;
  selectedTextTrack?: Int32;
  selectedAudioTrack?: Int32;
  paused?: boolean;
  muted?: boolean;
  volume?: Int32; // default 100
  progressUpdateInterval?: Float; // default 250
  textTrackDelay?: Int32; // delai en s i think

  onVideoLoad?: DirectEventHandler<OnLoadData>;
  onVideoLoadStart?: DirectEventHandler<{}>;
  onVideoBuffer?: DirectEventHandler<OnBufferData>;
  onVideoError?: DirectEventHandler<OnVideoErrorData>;
  onVideoProgress?: DirectEventHandler<OnProgressData>;
  onVideoEnd?: DirectEventHandler<{}>; // all
  onVideoPlaybackStateChanged?: DirectEventHandler<OnPlaybackStateChangedData>; // android only
}

export default codegenNativeComponent<NativeProps>(
  'VideoVLCView'
) as HostComponent<NativeProps>;



interface NativeCommands {
  seek: (viewRef: React.ElementRef<HostComponent<NativeProps>>, time: Float) => void;
};

export const Commands: NativeCommands =  codegenNativeCommands<NativeCommands>({
  supportedCommands: ['seek'],
});
