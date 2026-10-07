import AVFoundation
import ExpoModulesCore
import UIKit

/// Native preview + analysis overlay. Configuration arrives as props; the
/// session is (re)configured once per props batch in `applyProps()`.
final class LensCameraView: ExpoView {
  let onReady = EventDispatcher()
  let onStats = EventDispatcher()
  let onAnalysis = EventDispatcher()
  let onError = EventDispatcher()

  var config = CameraConfig()
  var analysis = AnalysisOptions()
  var active = true

  private let controller = CameraController()
  private let previewLayer: AVCaptureVideoPreviewLayer
  private let overlayView = UIImageView()
  private var statsTimer: Timer?
  private var running = false
  private var rotationCoordinator: AnyObject?
  private var rotationObservation: NSKeyValueObservation?

  required init(appContext: AppContext? = nil) {
    previewLayer = AVCaptureVideoPreviewLayer(session: controller.session)
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true

    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)

    overlayView.contentMode = .scaleAspectFill
    overlayView.clipsToBounds = true
    overlayView.isUserInteractionEnabled = false
    overlayView.alpha = 0.9
    addSubview(overlayView)

    controller.onReady = { [weak self] capabilities in
      guard let self else { return }
      self.setUpRotation()
      self.onReady(capabilities)
    }
    controller.onError = { [weak self] message in
      self?.onError(["message": message])
    }
    controller.onAnalysis = { [weak self] result in
      self?.show(result)
    }
  }

  deinit {
    statsTimer?.invalidate()
    controller.stop()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    previewLayer.frame = bounds
    CATransaction.commit()
    overlayView.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateRunning()
  }

  // MARK: Props

  func applyProps() {
    controller.setAnalysis(analysis)
    if !analysis.needsOverlay { overlayView.image = nil }
    if running {
      controller.update(config)
    }
    updateRunning()
  }

  private func updateRunning() {
    let shouldRun = window != nil && active && AVCaptureDevice.authorizationStatus(for: .video) == .authorized
    if shouldRun && !running {
      running = true
      controller.start(with: config)
      startStats()
    } else if !shouldRun && running {
      running = false
      controller.stop()
      stopStats()
    }
  }

  // MARK: Rotation (keeps preview, overlay and captures upright)

  private func setUpRotation() {
    guard let device = controller.device else { return }
    if #available(iOS 17.0, *) {
      let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: previewLayer)
      rotationCoordinator = coordinator
      apply(previewAngle: coordinator.videoRotationAngleForHorizonLevelPreview)
      rotationObservation = coordinator.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.new]) { [weak self] coordinator, _ in
        let angle = coordinator.videoRotationAngleForHorizonLevelPreview
        DispatchQueue.main.async { self?.apply(previewAngle: angle) }
      }
    } else if let connection = previewLayer.connection, connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
      controller.setAnalysisRotation(90)
    }
  }

  private func apply(previewAngle angle: CGFloat) {
    if #available(iOS 17.0, *) {
      if let connection = previewLayer.connection, connection.isVideoRotationAngleSupported(angle) {
        connection.videoRotationAngle = angle
      }
    }
    controller.setAnalysisRotation(angle)
  }

  private func captureAngle() -> CGFloat? {
    if #available(iOS 17.0, *), let coordinator = rotationCoordinator as? AVCaptureDevice.RotationCoordinator {
      return coordinator.videoRotationAngleForHorizonLevelCapture
    }
    return nil
  }

  // MARK: Stats + analysis

  private func startStats() {
    statsTimer?.invalidate()
    statsTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
      guard let self, let stats = self.controller.stats() else { return }
      self.onStats(stats)
    }
  }

  private func stopStats() {
    statsTimer?.invalidate()
    statsTimer = nil
  }

  private func show(_ result: FrameAnalysis) {
    if analysis.needsOverlay, let overlay = result.overlay {
      overlayView.image = UIImage(cgImage: overlay)
    } else if overlayView.image != nil {
      overlayView.image = nil
    }
    if let histogram = result.histogram {
      onAnalysis([
        "histogram": histogram,
        "clipLow": result.clipLow,
        "clipHigh": result.clipHigh,
      ])
    }
  }

  // MARK: Commands

  func takePhoto(raw: Bool, flash: String, promise: Promise) {
    controller.capturePhoto(raw: raw, flash: flash, rotation: captureAngle()) { result in
      switch result {
      case .success(let photo): promise.resolve(photo)
      case .failure(let error): promise.reject("ERR_CAPTURE", error.localizedDescription)
      }
    }
  }

  func startRecording(promise: Promise) {
    controller.startRecording(rotation: captureAngle()) { result in
      switch result {
      case .success(let video): promise.resolve(video)
      case .failure(let error): promise.reject("ERR_RECORDING", error.localizedDescription)
      }
    }
  }

  func stopRecording() {
    controller.stopRecording()
  }

  /// x/y are fractions of the view's size.
  func focus(x: Double, y: Double) {
    let layerPoint = CGPoint(x: x * Double(bounds.width), y: y * Double(bounds.height))
    let devicePoint = previewLayer.captureDevicePointConverted(fromLayerPoint: layerPoint)
    controller.focus(at: devicePoint)
  }
}
