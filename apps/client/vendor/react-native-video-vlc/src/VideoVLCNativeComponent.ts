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

type SideloadTracks = ReadonlyArray<
  Readonly<{
    title?: string;
    language?: string;
    uri: string;
  }>
>;

export type VideoSrc = Readonly<{
  uri?: string;
  requestHeaders?: Headers;
  startPosition?: Float;
  textTracks?: SideloadTracks;
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

  // Estilo de subtítulos (aplicado vía opciones freetype de libvlc). Cambiar
  // cualquiera de estos mientras el video ya está reproduciendo fuerza un
  // reload de VLCMedia en la posición actual — libvlc no permite cambiar el
  // renderer de subtítulos en caliente.
  subtitleFontScale?: Float; // 1 = normal, <1 chico, >1 grande
  subtitleColor?: Int32; // 0xRRGGBB
  subtitleBackgroundOpacity?: Int32; // 0-255

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
