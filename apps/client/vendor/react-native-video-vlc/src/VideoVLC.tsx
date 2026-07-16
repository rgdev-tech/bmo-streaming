import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ElementRef,
} from 'react';
import type { VideoVLCRef } from './types/video-ref';
import type { ReactVideoVLCProps, ReactVideoVLCSource } from './types/video';
import VideoVLCNativeComponent, {
  type VideoSrc,
  type OnBufferData,
  type OnLoadData,
  type OnPlaybackStateChangedData,
  type OnProgressData,
  type OnVideoErrorData,
  Commands,
} from './VideoVLCNativeComponent';
import {
  generateHeaderForNative,
  resolveAssetSourceForVideo,
} from './utils/utils';
import { View, StyleSheet } from 'react-native';
import type { NativeSyntheticEvent } from 'react-native';

const getNativeSource = (
  source?: ReactVideoVLCSource
): VideoSrc | undefined => {
  if (!source) return undefined;

  const resolvedSource = resolveAssetSourceForVideo(source);
  let uri = resolvedSource.uri || '';
  if (uri && uri.match(/^\//)) {
    uri = `file://${uri}`;
  }
  if (!uri) {
    console.log('Trying to load empty source');
  }

  return {
    uri,
    mediaOptions: resolvedSource.mediaOptions,
    minLoadRetryCount: resolvedSource.minLoadRetryCount,
    requestHeaders: generateHeaderForNative(resolvedSource.headers),
    startPosition: resolvedSource.startPosition,
    textTracks: resolvedSource.textTracks,
  };
};

const VideoVLC = forwardRef<VideoVLCRef, ReactVideoVLCProps>(
  (
    {
      initialSource,
      muted,
      selectedAudioTrack,
      selectedTextTrack,
      repeat,
      resizeMode,
      paused,
      volume,
      progressUpdateInterval,
      textTrackDelay,
      onBuffer,
      onEnd,
      onError,
      onLoad,
      onLoadStart,
      onPlaybackStateChanged,
      onProgress,
      style,
      ...rest
    },
    ref
  ) => {
    const nativeRef = useRef<ElementRef<typeof VideoVLCNativeComponent>>(null);
    const [nativeSource, setNativeSource] = useState<VideoSrc | undefined>(
      getNativeSource(initialSource)
    );

    // El inicializador de useState de arriba solo corre en el primer render —
    // si initialSource cambia después (p.ej. textTracks, cuando un subtítulo
    // termina de bajar después de que el video ya arrancó), quedaba ignorado
    // para siempre y el componente nativo nunca se enteraba. Filtramos por uri
    // y por la referencia de textTracks (no por el objeto initialSource entero,
    // que el caller recrea en cada render) para no re-disparar de más.
    useEffect(() => {
      setNativeSource(getNativeSource(initialSource));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialSource?.uri, initialSource?.textTracks]);

    const onVideoError = useCallback(
      (e: NativeSyntheticEvent<OnVideoErrorData>) => {
        onError?.(e.nativeEvent);
      },
      [onError]
    );

    const onVideoProgress = useCallback(
      (e: NativeSyntheticEvent<OnProgressData>) => {
        onProgress?.(e.nativeEvent);
      },
      [onProgress]
    );

    const onVideoBuffer = useCallback(
      (e: NativeSyntheticEvent<OnBufferData>) => {
        onBuffer?.(e.nativeEvent);
      },
      [onBuffer]
    );

    const onVideoLoad = useCallback(
      (e: NativeSyntheticEvent<OnLoadData>) => {
        onLoad?.(e.nativeEvent);
      },
      [onLoad]
    );

    const onVideoPlaybackStateChanged = useCallback(
      (e: NativeSyntheticEvent<OnPlaybackStateChangedData>) => {
        onPlaybackStateChanged?.(e.nativeEvent);
      },
      [onPlaybackStateChanged]
    );

    const seek = useCallback((time: number) => {
      if (time == null || isNaN(time)) {
        throw new Error('Invalid time');
      }

      if(!nativeRef.current) {
        throw new Error("Ref is null")
      }
      let wantedTime = time;
      if (wantedTime < 0) wantedTime = 0;

      Commands.seek(nativeRef.current, wantedTime);
    }, []); 

    const setSource = useCallback((source?: ReactVideoVLCSource) => {
      setNativeSource(getNativeSource(source));
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        seek,
        setSource,
      }),
      []
    );

    return (
      <View style={style} {...rest}>
        <VideoVLCNativeComponent
          ref={nativeRef}
          style={StyleSheet.absoluteFillObject}
          src={nativeSource}
          muted={muted}
          resizeMode={resizeMode}
          paused={paused}
          repeat={repeat}
          volume={volume}
          progressUpdateInterval={progressUpdateInterval}
          textTrackDelay={textTrackDelay}
          selectedAudioTrack={selectedAudioTrack}
          selectedTextTrack={selectedTextTrack}
          onVideoEnd={onEnd}
          onVideoLoadStart={onLoadStart}
          onVideoError={onError ? onVideoError : undefined}
          onVideoProgress={onProgress ? onVideoProgress : undefined}
          onVideoBuffer={onBuffer ? onVideoBuffer : undefined}
          onVideoLoad={onLoad ? onVideoLoad : undefined}
          onVideoPlaybackStateChanged={
            onPlaybackStateChanged ? onVideoPlaybackStateChanged : undefined
          }
        />
      </View>
    );
  }
);
VideoVLC.displayName = 'VideoVLC';
export default VideoVLC;
