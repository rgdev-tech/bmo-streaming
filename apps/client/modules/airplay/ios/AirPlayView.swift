import ExpoModulesCore
import AVKit
import AVFoundation

// Wraps AVRoutePickerView — the ONLY Apple-sanctioned AirPlay button. Tapping it
// presents the system route picker; selecting an Apple TV / AirPlay 2 TV routes
// AVPlayer video there automatically (allowsExternalPlayback defaults to true).
// We also observe the audio route so JS can react when casting starts/stops
// (used to force an HLS re-resolve for VLC/mkv sources that can't AirPlay).
class AirPlayView: ExpoView {
  let routePicker = AVRoutePickerView()
  let onConnectionChange = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    routePicker.prioritizesVideoDevices = true
    routePicker.tintColor = .white
    routePicker.backgroundColor = .clear
    addSubview(routePicker)

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(routeChanged),
      name: AVAudioSession.routeChangeNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    routePicker.frame = bounds
  }

  @objc private func routeChanged() {
    let connected = AVAudioSession.sharedInstance().currentRoute.outputs
      .contains { $0.portType == .airPlay }
    // Route-change notifications can arrive off the main thread; the event
    // dispatch and any downstream React work must happen on main.
    DispatchQueue.main.async { [weak self] in
      self?.onConnectionChange(["connected": connected])
    }
  }
}
