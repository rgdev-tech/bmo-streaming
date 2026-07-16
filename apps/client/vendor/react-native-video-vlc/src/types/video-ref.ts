import type { ReactVideoVLCSource } from "./video";

export interface VideoVLCRef {
  seek: (time: number) => void;
  setSource: (source: ReactVideoVLCSource | undefined) => void;
}
