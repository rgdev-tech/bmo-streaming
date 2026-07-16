package com.videovlc

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.uimanager.ThemedReactContext
import com.videovlc.api.BasicTrack
import com.videovlc.api.SideLoadedTrack
import com.videovlc.api.VideoBasicTrack
import com.videovlc.api.VideoSrc
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.MediaPlayer.ScaleType
import org.videolan.libvlc.interfaces.IMedia
import org.videolan.libvlc.util.VLCVideoLayout

class VideoVLCView(context: ThemedReactContext, libVLC: LibVLC) :
        VLCVideoLayout(context), LifecycleEventListener {

  internal final val eventEmitter = VideoVLCEventEmitter()

  private val mlibVLC: LibVLC = libVLC
  private val mMediaPlayer: MediaPlayer = MediaPlayer(libVLC)
  private val mThemedReactContext: ThemedReactContext = context

  val mHandlerMainThread: Handler

  private var lastProgressUpdateTime: Long = 0
  private var mPlaybackStarted: Boolean = false
  private var mMediaParsed: Boolean = false
  private var mIsSeekRequested: Boolean = false
  private var mIsHostPause: Boolean = false

  private var src: VideoSrc = VideoSrc()
  private var paused: Boolean = false
  private var muted: Boolean = false
  private var volume = 100
  private var repeat: Boolean = false
  private var selectedTextTrack: Int = -1
  private var selectedAudioTrack: Int = -1
  private var progressUpdateInterval: Float = 250.0f
  private var scaleType: ScaleType = ScaleType.SURFACE_BEST_FIT
  private var spuDelay: Long = 0L

  private val mPlayerListener =
          MediaPlayer.EventListener { event ->
            when (event.type) {
              MediaPlayer.Event.EndReached -> {
                eventEmitter.onVideoEnd()
                if (repeat) {
                  // Player is actually stoped
                  val currentSource = src
                  src = VideoSrc()
                  setSource(currentSource)
                } else {
                  unloadMedia()
                }
              }
              MediaPlayer.Event.Playing -> {
                eventEmitter.onVideoPlaybackStateChanged(true, false)
                if (!mPlaybackStarted) {
                  // Started correctly
                  mPlaybackStarted = true
                }
                setKeepScreenOn(true)
              }
              MediaPlayer.Event.Opening -> {
                setKeepScreenOn(true)
              }
              MediaPlayer.Event.Paused -> {
                eventEmitter.onVideoPlaybackStateChanged(false, false)
                setKeepScreenOn(false)
              }
              MediaPlayer.Event.Buffering -> {
                eventEmitter.onVideoBuffer(true)
              }
              MediaPlayer.Event.Stopped -> {}
              MediaPlayer.Event.EncounteredError -> {
                eventEmitter.onVideoError("VLC Player Error", 1000)
                unloadMedia()
              }
              MediaPlayer.Event.TimeChanged -> handleProgressUpdate()
            }
          }

  private val mMediaListener =
          IMedia.EventListener { event ->
            when (event.type) {
              IMedia.Event.ParsedChanged -> {
                if (event.parsedStatus == IMedia.ParsedStatus.Done) {
                  onVideoLoaded()
                }
              }
            }
          }

  init {
    mHandlerMainThread = Handler(Looper.getMainLooper())
    mThemedReactContext.addLifecycleEventListener(this)
    mMediaPlayer.setEventListener(mPlayerListener)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    setBackgroundResource(R.drawable.video_view_background)
    attachVLCVoutViews()
  }

  private val mMeasureAndLayout = Runnable {
    measure(
            MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
    )
    layout(left, top, right, bottom)
  }

  fun handleProgressUpdate() {
    if (!mMediaParsed) return // Not progress event before onVideoLoad
    val now = System.currentTimeMillis()
    if (now - lastProgressUpdateTime > progressUpdateInterval) {
      Log.d(TAG, "Progress ${mMediaPlayer.time}")
      eventEmitter.onVideoProgress(mMediaPlayer.time, mMediaPlayer.length, mMediaPlayer.position)
      lastProgressUpdateTime = now
    }

    if (mIsSeekRequested) {
      mIsSeekRequested = false
      // eventEmitter.onVideoSeek()
    }
  }

  fun applyModifiers() {
    mMediaPlayer.volume = if (muted) 0 else volume
    if (spuDelay != 0L) {
      mMediaPlayer.spuDelay = spuDelay
    }
  }

  /* COMMANDS */
  fun play() {
    if (!mMediaPlayer.isReleased()) {
      mMediaPlayer.play()
    }
  }

  fun pause() {
    if (!mMediaPlayer.isReleased()) {
      mMediaPlayer.pause()
    }
  }

  private fun requestSeek(time: Long) {
    if (!mMediaPlayer.isReleased()) {
      lastProgressUpdateTime = 0
      mIsSeekRequested = true
      //  mEventEmitter.emitOnSeekRequested(time)
    }
  }

  fun seek(time: Long) {
    if (!mMediaPlayer.isReleased()) {
      requestSeek(time)
      mMediaPlayer.setTime(time * 1000L)
    }
  }

  /* PROPS */
  fun updateUpdateProgress(newInterval: Float) {
    if (newInterval != progressUpdateInterval) {
      progressUpdateInterval = newInterval
    }
  }

  fun setRepeatModifier(repeatparam: Boolean) {
    Log.d(TAG, "Repeat modifier")
    if (repeatparam != repeat) {
      repeat = repeatparam
    }
  }

  fun setTextTrackDelay(newDelay: Int) {
    Log.d(TAG, "Track delay modifier")
    val delLong = newDelay.toLong() * 1_000_000 // mircroseconds
    if (delLong != spuDelay) {
      spuDelay = delLong
      mMediaPlayer.spuDelay = delLong
    }
  }

  fun setMutedModifier(mutedparam: Boolean) {
    Log.d(TAG, "Mited modifier")
    if (muted != mutedparam) {
      muted = mutedparam
      mMediaPlayer.volume = if (mutedparam) 0 else volume
    }
  }

  fun setVolumeModifier(vol: Int) {
    if (vol == volume) return
    volume = vol
    if (!muted) {
      mMediaPlayer.volume = vol
    }
  }

  fun setTextIdTrack(trackId: Int) {
    if (trackId != selectedTextTrack) {
      selectedTextTrack = trackId
      mMediaPlayer.spuTrack = trackId
    }
  }

  fun setAudioIdTrack(trackId: Int) {
    if (trackId != selectedAudioTrack) {
      selectedAudioTrack = trackId
      mMediaPlayer.audioTrack = trackId
    }
  }

  fun setResizeMode(mode: String?) {
    Log.d(TAG, "Resize mode modifier")

    val newScale =
            when (mode) {
              "none" -> ScaleType.SURFACE_BEST_FIT
              "cover" -> ScaleType.SURFACE_FIT_SCREEN
              "stretch" -> ScaleType.SURFACE_FILL
              "original" -> ScaleType.SURFACE_ORIGINAL
              "16:9" -> ScaleType.SURFACE_16_9
              "16:10" -> ScaleType.SURFACE_16_10
              "4:3" -> ScaleType.SURFACE_4_3
              "5:4" -> ScaleType.SURFACE_5_4
              "2.35:1" -> ScaleType.SURFACE_235_1
              "2.21:1" -> ScaleType.SURFACE_221_1
              "2.39:1" -> ScaleType.SURFACE_239_1
              else -> ScaleType.SURFACE_BEST_FIT
            }

    if (newScale != scaleType) {
      scaleType = newScale

      mMediaPlayer.videoScale = newScale
      //  mHandlerMainThread.post(mMeasureAndLayout)
    }
  }

  private fun onVideoLoaded() {
    Log.d(TAG, "Video loaded")
    val media = mMediaPlayer.media
    if (media == null) return
    mMediaParsed = true
    val textIdTrack = selectedTextTrack
    mMediaPlayer.spuTrack = textIdTrack

    val audioIdTrac = selectedAudioTrack
    if (audioIdTrac != -1) {
      mMediaPlayer.audioTrack = audioIdTrac
    }

    val videoSelectedTrack = mMediaPlayer.currentVideoTrack

    val textTracks = ArrayList<BasicTrack>()
    val audioTracks = ArrayList<BasicTrack>()
    val videosTracks = ArrayList<VideoBasicTrack>()

    val tracksCount = media.trackCount
    if (tracksCount > 0) {
      val slaves = media.slaves
      val currentSelectedIdVideo = mMediaPlayer.videoTrack
      val currentSelectedIdAudio = mMediaPlayer.audioTrack
      val currentSelectedIdText = mMediaPlayer.spuTrack
      val sideLoadedStart = tracksCount - (slaves?.size ?: 0)

      // Sideloaded tracks have index the most hight, because they are loaded after
      // So i use that for match with sideloaded tracks from source
      for (i in 0 until tracksCount) {
        val vlcTrack = media.getTrack(i)
        when (vlcTrack) {
          is IMedia.AudioTrack -> {
            audioTracks.add(BasicTrack.parse(vlcTrack, currentSelectedIdAudio, null))
          }
          is IMedia.SubtitleTrack -> {
            var sideTr: SideLoadedTrack? = null
            if (i >= sideLoadedStart) {
              val slave = slaves.get(i - sideLoadedStart)
              if (slave.type == IMedia.Slave.Type.Subtitle) {
                sideTr = src.sideLoadedTextTracks?.tracks?.find { it.uri == slave.uri }
              }
            }
            textTracks.add(BasicTrack.parse(vlcTrack, currentSelectedIdText, sideTr))
          }
          is IMedia.VideoTrack ->
                  videosTracks.add(VideoBasicTrack.parse(vlcTrack, currentSelectedIdVideo))
        }
      }
    }

    if (src.startPosition >= 0) {
      mMediaPlayer.time = src.startPosition.toLong() * 1000L
    }

    eventEmitter.onVideoLoad(
            mMediaPlayer.length,
            mMediaPlayer.time,
            videoSelectedTrack?.width ?: 0,
            videoSelectedTrack?.height ?: 0,
            audioTracks,
            textTracks,
            videosTracks
    )
  }

  fun setSource(source: VideoSrc) {
    Log.d(TAG, "reset set")

    if (source.isEquals(src)) {
      return
    }

    unloadMedia()

    if (source.uri != null) {
      src = source

      val media = Media(mlibVLC, source.uri)

      media.setEventListener(mMediaListener)

      if (source.startPosition >= 0) {
        media.addOption(":start-time=${source.startPosition}")
      }

      if (paused) {
        media.addOption(":start-paused")
      }

      if (source.minLoadRetryCount > 0) {
        media.addOption(":http-retry=${source.minLoadRetryCount}")
      }

      for (header in source.headers) {
        media.addOption(":http-header=${header.key}=${header.value}")
      }

      for (opt in source.mediaOptions) {
        media.addOption(opt)
      }

      val sideloadTracks = source.sideLoadedTextTracks
      if (sideloadTracks != null) {
        for (externText in sideloadTracks.tracks) {
          media.addSlave(IMedia.Slave(IMedia.Slave.Type.Subtitle, 1, externText.uri))
        }
      }

      mMediaPlayer.media = media
      mMediaPlayer.play()
      applyModifiers()

      eventEmitter.onVideoLoadStart()
    }
  }

  fun setPausedModifier(pause: Boolean) {
    if (pause != paused) {
      paused = pause
      if (pause) mMediaPlayer.pause() else mMediaPlayer.play()
    }
  }

  fun cleanUpPlayer() {
    detachVLCVoutViews()
    mThemedReactContext.removeLifecycleEventListener(this)
    mMediaPlayer.setEventListener(null)
    if (!mMediaPlayer.isReleased()) {
      mMediaPlayer.stop()
      mMediaPlayer.release()
    }
    cleanVariables()
    setKeepScreenOn(false)
  }

  override fun requestLayout() {
    super.requestLayout()
    if (mHandlerMainThread != null) {
      mHandlerMainThread.post(mMeasureAndLayout)
    }
  }

  fun attachVLCVoutViews() {
    val vout = mMediaPlayer.getVLCVout()
    if (!vout.areViewsAttached()) {
      mMediaPlayer.attachViews(this, null, true, false)
      mMediaPlayer.setVideoScale(scaleType)
    }
  }

  fun detachVLCVoutViews() {
    val vout = mMediaPlayer.getVLCVout()
    if (vout.areViewsAttached()) {
      mMediaPlayer.detachViews()
    }
  }

  private fun cleanVariables() {
    mPlaybackStarted = false
    mMediaParsed = false
    lastProgressUpdateTime = 0
    mIsSeekRequested = false
    src = VideoSrc()
  }

  fun unloadMedia() {
    cleanVariables()
    mMediaPlayer.media = null
    mMediaPlayer.stop()
    mMediaPlayer.setSpuTrack(-1)
    mMediaPlayer.setAudioTrack(-1)
    setKeepScreenOn(false)
  }

  override fun onHostDestroy() {
    cleanUpPlayer()
  }

  override fun onHostPause() {
    try {
      if (!mMediaPlayer.isReleased() && !paused) {
        paused = true
        mIsHostPause = true
        mMediaPlayer.pause()
      }
    } catch (e: Throwable) {}
  }

  override fun onHostResume() {
    if (!mMediaPlayer.isReleased()) {
      attachVLCVoutViews()
      if (mIsHostPause) {
        mIsHostPause = false
        paused = false
        mMediaPlayer.play()
      }
    }
  }

  companion object {
    const val TAG = "VideoVLCView"
  }
}