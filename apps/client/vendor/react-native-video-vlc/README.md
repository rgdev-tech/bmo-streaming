# react-native-video-vlc

`react-native-video-vlc` is a React Native library that provides a native video component based on VLC, enabling smooth and customizable video playback in your React Native applications.

---

## Features

- Customizable video playback with support for multiple resize modes.
- Audio and subtitle track selection.
- Progress updates and event handling.
- Native VLC capabilities for robust media handling.
- Text track sideloading and delay support.

---

## Installation

To install the library, run:

```bash
npm install react-native-video-vlc
```

Or with yarn:

```bash
yarn add react-native-video-vlc
```

---

## Usage

Here is an example of how to use the `VideoVLC` component:

```tsx
import { StyleSheet } from 'react-native';
import VideoVLC from 'react-native-video-vlc';

const App = () => {
  return (
    <VideoVLC
      style={styles.container}
      source={{ uri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' }}
      onProgress={(e) => console.log('Progress:', e)}
      onError={(e) => console.error('Error:', e)}
      onLoad={(e) => console.log('Video Loaded:', e)}
      onEnd={() => console.log('Video Ended')}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
export default App;

```

---

## Props

### Main Props

| Prop                  | Type                                | Default  | Description                                                                 |
|-----------------------|-------------------------------------|----------|-----------------------------------------------------------------------------|
| `source`             | `ReactVideoVLCSource`              | `null`   | Video source. Supports remote URLs or local files.                          |
| `repeat`             | `boolean`                          | `false`  | If true, the video will loop indefinitely.                                  |
| `resizeMode`         | `EnumValues<VideoResizeMode>`      | `none`   | Defines how the video should be resized within its container.               |
| `paused`             | `boolean`                          | `false`  | Pauses the video playback when true.                                        |
| `muted`              | `boolean`                          | `false`  | Mutes the audio when true.                                                  |
| `volume`             | `number`                           | `100`    | Sets the audio volume (0-100).                                              |
| `progressUpdateInterval` | `number`                      | `250`    | Interval (ms) for `onProgress` updates.                                     |
| `selectedTextTrack`  | `number`                           | `null`   | Index of the selected text (subtitle) track.                                |
| `selectedAudioTrack` | `number`                           | `null`   | Index of the selected audio track.                                          |
| `textTrackDelay`     | `number`                           | `0`      | Delay for text (subtitle) tracks in seconds.                           |

### Source Properties

| Property           | Type                  | Default  | Description                                                   |
|--------------------|-----------------------|----------|---------------------------------------------------------------|
| `uri`             | `string | NodeRequire` | `null`   | The video source URI. Supports both remote and local sources. |
| `minLoadRetryCount` | `number`            | `0`      | Minimum retry attempts for loading.                          |
| `mediaOptions`    | `string[]`            | `null`   | VLC-specific media options.                                   |
| `headers`         | `Headers`             | `{}`     | HTTP headers for fetching the video. A record of key-value pairs where the key is the header name and the value is the header value. Example: `{ 'Authorization': 'Bearer token' }`. |
| `startPosition`   | `number`              | `0`      | Start position of the video in seconds.                      |
| `textTracks`      | `SideloadTrack[]`     | `[]`     | Array of subtitle tracks to sideload. See `SideloadTrack` for details.      |

### SideloadTrack

| Property  | Type     | Description                                                       |
|-----------|----------|-------------------------------------------------------------------|
| `title`   | `string` | The title of the subtitle track. Optional.                       |
| `language`| `string` | The language code of the subtitle track (e.g., 'en', 'fr'). Optional. |
| `uri`     | `string` | URI of the subtitle file to sideload. Required.                  |

### Events

| Event                       | Callback Parameters            | Description                                                        |
|-----------------------------|---------------------------------|--------------------------------------------------------------------|
| `onEnd`                    | `()`                           | Called when the video playback finishes.                          |
| `onBuffer`                 | `OnBufferData`                 | Triggered during buffering. Contains: `{ isBuffering: boolean }`. |
| `onError`                  | `OnVideoErrorData`             | Triggered when an error occurs. Contains: `{ error: { errorString: string, errorCode: number } }`. |
| `onLoad`                   | `OnLoadData`                   | Called when the video is loaded. Provides detailed information. See `OnLoadData` below. |
| `onLoadStart`              | `()`                           | Triggered when the video starts loading.                          |
| `onProgress`               | `OnProgressData`               | Called at regular intervals with progress information (in seconds). Contains: `{ currentTime: number, seekableDuration: number, progress: number }`. |
| `onPlaybackStateChanged`   | `OnPlaybackStateChangedData`   | Triggered when playback state changes. Contains: `{ isPlaying: boolean, isSeeking: boolean }`. |

#### `OnLoadData`

The `onLoad` event provides the following data:

| Property         | Type                                  | Description                                                                 |
|------------------|---------------------------------------|-----------------------------------------------------------------------------|
| `currentTime`    | `number`                              | Current playback position (in seconds) when the video is loaded.           |
| `duration`       | `number`                              | Total duration of the video (in seconds).                                   |
| `naturalSize`    | `object`                              | Contains the video's dimensions and orientation.                           |
| `naturalSize.width`  | `number`                          | Width of the video in pixels.                                              |
| `naturalSize.height` | `number`                          | Height of the video in pixels.                                             |
| `naturalSize.orientation` | `'landscape', 'portrait', 'square'` | The video's orientation.                                                   |
| `videoTracks`    | `Array<{ id: number, selected: boolean, title?: string, language?: string }>` | Details of available video tracks. Each track has an ID, selection state, title (optional), and language (optional). |
| `audioTracks`    | `Array<{ id: number, selected: boolean, title?: string, language?: string }>` | Details of available audio tracks. Each track has an ID, selection state, title (optional), and language (optional). |
| `textTracks`     | `Array<{ id: number, selected: boolean, title?: string, language?: string }>` | Details of available text (subtitle) tracks. Each track has an ID, selection state, title (optional), and language (optional). |

---

## Enums

### `VideoResizeMode`

- `none`: Default mode.
- `cover`: Scale the video uniformly to cover the container.
- `stretch`: Stretch the video to fill the container.
- `original`: Display the video in its original size.
- `16:9`, `16:10`, `4:3`, `5:4`, `2.35:1`, `2.21:1`, `2.39:1`: Aspect ratio presets.

---

## Ref Methods

The `VideoVLC` component exposes the following methods via a ref:

| Method      | Parameters         | Description                                         |
|-------------|--------------------|-----------------------------------------------------|
| `seek`      | `time: number`     | Seeks the video to the specified time (in seconds). |

To use the `ref` methods, you can follow this example:

```tsx
import React, { useRef } from 'react';
import { StyleSheet, View, Button } from 'react-native';
import VideoVLC from 'react-native-video-vlc';

const App = () => {
  const videoRef = useRef(null);

  const handleSeek = () => {
    if (videoRef.current) {
      videoRef.current.seek(30); // Seek to 30 seconds
    }
  };

  return (
    <View style={styles.container}>
      <VideoVLC
        style={styles.video}
        ref={videoRef}
        source={{ uri: 'https://example.com/video.mp4' }}
        resizeMode="cover"
      />
      <Button title="Seek to 30s" onPress={handleSeek} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    height: 300
  }
});

export default App;
```

---

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests on GitHub.

---

## License

`react-native-video-vlc` is released under the MIT License. See [LICENSE](LICENSE) for details.
