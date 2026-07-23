import ExpoModulesCore
import AVKit
import AVFoundation

public class AirPlayModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AirPlay")

    // Whether an external AirPlay route is currently the active audio output.
    // Used by JS to decide, on mount, if we should already be casting (e.g. the
    // user connected via Control Center before opening the player).
    Function("isConnected") { () -> Bool in
      AVAudioSession.sharedInstance().currentRoute.outputs
        .contains { $0.portType == .airPlay }
    }

    View(AirPlayView.self) {
      // Fires whenever the AirPlay connection state changes. `connected` is true
      // when an AirPlay output becomes active, false when it goes away.
      Events("onConnectionChange")

      // Optional hex tint (e.g. "#FFFFFF"). Parsed manually — no reliance on
      // ExpoModulesCore's UIColor conversion, so it always compiles.
      Prop("tint") { (view: AirPlayView, hex: String?) in
        if let hex, let color = UIColor(hex: hex) { view.routePicker.tintColor = color }
      }
      Prop("activeTint") { (view: AirPlayView, hex: String?) in
        if let hex, let color = UIColor(hex: hex) { view.routePicker.activeTintColor = color }
      }
    }
  }
}

extension UIColor {
  // Minimal hex parser: "#RGB", "#RRGGBB" or "#RRGGBBAA" (with or without '#').
  convenience init?(hex: String) {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() } // #RGB → #RRGGBB
    guard let value = UInt64(s, radix: 16) else { return nil }
    let r, g, b, a: CGFloat
    switch s.count {
    case 6:
      r = CGFloat((value & 0xFF0000) >> 16) / 255
      g = CGFloat((value & 0x00FF00) >> 8) / 255
      b = CGFloat(value & 0x0000FF) / 255
      a = 1
    case 8:
      r = CGFloat((value & 0xFF000000) >> 24) / 255
      g = CGFloat((value & 0x00FF0000) >> 16) / 255
      b = CGFloat((value & 0x0000FF00) >> 8) / 255
      a = CGFloat(value & 0x000000FF) / 255
    default:
      return nil
    }
    self.init(red: r, green: g, blue: b, alpha: a)
  }
}
