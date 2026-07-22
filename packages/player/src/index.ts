// @bmo/player — lógica y estado de reproducción, headless y compartida entre
// apps/client (teléfono) y apps/tv (control remoto). NO incluye UI ni el motor
// de video: cada app dibuja su propio HUD/menú y monta su motor (expo-video /
// VLC), consumiendo estos hooks. Ver packages/player/package.json para las
// restricciones de peer-deps (react pinneado, @bmo/core provisto por la app).

export * from './types'
export {
  fmt,
  isSpanish,
  describeSource,
  audioLangLabel,
  stripEpisodeSuffix,
  episodeLabel,
  resolvePlaybackUri,
} from './format'
export { usePlaybackSource, type PlaybackSource, type PlaybackSourceParams } from './usePlaybackSource'
export {
  useSpanishSubs,
  fetchSpanishSubsInMemory,
  type SpanishSubsFetcher,
  type SpanishSubsOptions,
} from './useSpanishSubs'
export { useSubtitlePrefs, type SubtitlePrefs } from './useSubtitlePrefs'
export { useProgressSaver, type ProgressSaver } from './useProgressSaver'
export {
  useAutoHideControls,
  useSeekHint,
  type AutoHideControls,
  type SeekHint,
} from './useAutoHideControls'
