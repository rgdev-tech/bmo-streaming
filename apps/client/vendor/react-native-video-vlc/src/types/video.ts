import type { ViewProps } from 'react-native';
import type { ReactVideoVLCEvents } from './events';

export type Headers = Record<string, string>;

export type EnumValues<T extends string | number> = T extends string
  ? `${T}` | T
  : T;

export type SideloadTrack = {
  title?: string;
  language?: string;
  uri: string;
};

export type ReactVideoVLCSourceProperties = {
  uri?: string;
  minLoadRetryCount?: number;
  mediaOptions?: string[];
  headers?: Headers;
  startPosition?: number;
  textTracks?: SideloadTrack[];
};

export enum VideoResizeMode {
  NONE = 'none', // default
  COVER = 'cover',
  STRETCH = 'stretch',
  ORIGINAL = 'original',
  RATIO_16_9 = '16:9',
  RATIO_16_10 = '16:10',
  RATIO_4_3 = '4:3',
  RATIO_5_4 = '5:4',
  RATIO_235_1 = '2.35:1',
  RATIO_221_1 = '2.21:1',
  RATIO_239_1 = '2.39:1',
}

export type ReactVideoVLCSource = Readonly<
  Omit<ReactVideoVLCSourceProperties, 'uri'> & {
    uri?: string | NodeRequire;
  }
>;

export interface ReactVideoVLCProps extends ReactVideoVLCEvents, ViewProps {
  initialSource?: ReactVideoVLCSource;
  repeat?: boolean;
  resizeMode?: EnumValues<VideoResizeMode>;
  selectedTextTrack?: number;
  selectedAudioTrack?: number;
  paused?: boolean;
  muted?: boolean;
  volume?: number; // 0-100, default 100
  progressUpdateInterval?: number; // default 250
  textTrackDelay?: number;
  subtitleFontScale?: number; // 1 = normal, <1 chico, >1 grande
  subtitleColor?: number; // 0xRRGGBB
  subtitleBackgroundOpacity?: number; // 0-255
}
