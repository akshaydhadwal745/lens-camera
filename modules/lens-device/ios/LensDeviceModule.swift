import ExpoModulesCore

/// Device signals Lens adapts to. Thermal level: ProcessInfo.thermalState,
/// reduced to normal / warm / hot / critical (same names as Android).
public class LensDeviceModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("LensDevice")
    Events("onThermalChange")

    Function("thermalLevel") { () -> String in
      Self.level()
    }

    // Background backup is Android-only for now (iOS needs background URLSessions).
    Function("startBackup") { (_: String) -> Bool in false }
    Function("updateBackup") { (_: String, _: Int) in }
    Function("stopBackup") {}

    // No install referrer on iOS (codes are typed instead).
    AsyncFunction("installReferrer") { () -> String? in nil }
    Function("isEmulator") { () -> Bool in
      #if targetEnvironment(simulator)
      return true
      #else
      return false
      #endif
    }

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(
        forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onThermalChange", ["level": Self.level()])
      }
    }

    OnStopObserving {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.observer = nil
    }
  }

  static func level() -> String {
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: return "normal"
    case .fair: return "warm"
    case .serious: return "hot"
    case .critical: return "critical"
    @unknown default: return "normal"
    }
  }
}
