package com.videovlc

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.VideoVLCViewManagerDelegate
import com.facebook.react.viewmanagers.VideoVLCViewManagerInterface
import com.videovlc.api.VideoSrc
import com.videovlc.toolbox.ReactBridgeUtils.safeGetDoubleFromArray
import org.videolan.libvlc.LibVLC


@ReactModule(name = VideoVLCViewManager.NAME)
class VideoVLCViewManager(appContext: ReactApplicationContext) : SimpleViewManager<VideoVLCView>(),
  VideoVLCViewManagerInterface<VideoVLCView> {
  private val mDelegate: ViewManagerDelegate<VideoVLCView> = VideoVLCViewManagerDelegate(this)
  private val libVLC =
          LibVLC(appContext, arrayListOf("--http-reconnect", "--freetype-background-opacity=70"))


  override fun getDelegate(): ViewManagerDelegate<VideoVLCView>? {
    return mDelegate
  }

  override fun getName(): String {
    return NAME
  }

  public override fun createViewInstance(context: ThemedReactContext): VideoVLCView {
    return VideoVLCView(context, libVLC)
  }
  override fun onDropViewInstance(view: VideoVLCView) {
    view.cleanUpPlayer()
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> = EventTypes.toMap()

  override fun addEventEmitters(reactContext: ThemedReactContext, view: VideoVLCView) {
    super.addEventEmitters(reactContext, view)
    view.eventEmitter.addEventEmitters(reactContext, view)
  }

  @ReactProp(name = PROP_SRC)
  override fun setSrc(videoView: VideoVLCView, src: ReadableMap?) {
    val context = videoView.context.applicationContext
    videoView.setSource(VideoSrc.parse(src, context))
  }

  @ReactProp(name = PROP_REPEAT, defaultBoolean = false)
  override fun setRepeat(videoView: VideoVLCView, repeat: Boolean) {
    videoView.setRepeatModifier(repeat)
  }

  @ReactProp(name = PROP_RESIZE_MODE)
  override fun setResizeMode(videoView: VideoVLCView, resizeMode: String?) {
    videoView.setResizeMode(resizeMode)
  }

  @ReactProp(name = PROP_SELECTED_TEXT_TRACK, defaultInt = -1)
  override fun setSelectedTextTrack(videoView: VideoVLCView, selectedTextTrack: Int) {
    videoView.setTextIdTrack(selectedTextTrack)
  }

  @ReactProp(name = PROP_SELECTED_AUDIO_TRACK, defaultInt = -1)
  override fun setSelectedAudioTrack(videoView: VideoVLCView, selectedAudioTrack: Int) {
    videoView.setAudioIdTrack(selectedAudioTrack)
  }

  @ReactProp(name = PROP_PAUSED, defaultBoolean = false)
  override fun setPaused(videoView: VideoVLCView, paused: Boolean) {
    videoView.setPausedModifier(paused)
  }

  @ReactProp(name = PROP_MUTED, defaultBoolean = false)
  override fun setMuted(videoView: VideoVLCView, muted: Boolean) {
    videoView.setMutedModifier(muted)
  }

  @ReactProp(name = PROP_VOLUME, defaultInt = 100)
  override fun setVolume(videoView: VideoVLCView, volume: Int) {
    videoView.setVolumeModifier(volume)
  }

  @ReactProp(name = PROP_PROGRESS_UPDATE_INTERVAL, defaultFloat = 250.0f)
  override fun setProgressUpdateInterval(videoView: VideoVLCView, progressUpdateInterval: Float) {
    videoView.updateUpdateProgress(progressUpdateInterval)
  }

  @ReactProp(name = PROP_TEXT_TRACK_DELAY, defaultInt = 0)
  override fun setTextTrackDelay(videoView: VideoVLCView, textTrackDelay: Int) {
    videoView.setTextTrackDelay(textTrackDelay)
  }


  override fun seek(videoView: VideoVLCView, time: Float) {
    videoView.seek(time.toLong())
  }

  companion object {
    const val NAME = "VideoVLCView"
    private const val PROP_SRC = "src"
    private const val PROP_REPEAT = "repeat"
    private const val PROP_RESIZE_MODE = "resizeMode"
    private const val PROP_SELECTED_TEXT_TRACK = "selectedTextTrack"
    private const val PROP_SELECTED_AUDIO_TRACK = "selectedAudioTrack"
    private const val PROP_PAUSED = "paused"
    private const val PROP_MUTED = "muted"
    private const val PROP_VOLUME = "volume"
    private const val PROP_PROGRESS_UPDATE_INTERVAL = "progressUpdateInterval"
    private const val PROP_TEXT_TRACK_DELAY = "textTrackDelay"
  }
}
