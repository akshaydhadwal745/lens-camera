import AVFoundation
import CoreImage
import ExpoModulesCore
import MetalKit
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
  /// Live look shown in the viewfinder (nil = none).
  var look: String?
  var lookIntensity: Double = 1

  private let controller = CameraController()
  private let previewLayer: AVCaptureVideoPreviewLayer
  private let overlayView = UIImageView()
  private var statsTimer: Timer?
  private var running = false
  private var rotationCoordinator: AnyObject?
  private var rotationObservation: NSKeyValueObservation?

  // Live look rendering (Metal + Core Image). Frames come from the analysis
  // data output; the plain preview layer stays underneath as a fallback.
  private let metalDevice = MTLCreateSystemDefaultDevice()
  private lazy var commandQueue = metalDevice?.makeCommandQueue()
  private lazy var lookContext: CIContext? = metalDevice.map { CIContext(mtlDevice: $0, options: [.cacheIntermediates: false]) }
  private lazy var lookView: MTKView = {
    let view = MTKView(frame: .zero, device: metalDevice)
    view.framebufferOnly = false
    view.isPaused = true
    view.enableSetNeedsDisplay = false
    view.isHidden = true
    view.isUserInteractionEnabled = false
    view.delegate = self
    return view
  }()
  private let frameLock = NSLock()
  private var latestFrame: CIImage?
  private var latestFrameTime: CFTimeInterval = 0
  private var lookDisplayLink: CADisplayLink?

  required init(appContext: AppContext? = nil) {
    previewLayer = AVCaptureVideoPreviewLayer(session: controller.session)
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true

    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)

    addSubview(lookView)

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
    controller.onPreviewFrame = { [weak self] frame in
      guard let self else { return }
      self.frameLock.lock()
      self.latestFrame = frame
      self.latestFrameTime = CACurrentMediaTime()
      self.frameLock.unlock()
    }
  }

  deinit {
    statsTimer?.invalidate()
    lookDisplayLink?.invalidate()
    controller.stop()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    previewLayer.frame = bounds
    CATransaction.commit()
    lookView.frame = bounds
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
    updateLiveLook()
  }

  // MARK: Live look

  private var lookActive: Bool { look != nil && lookIntensity > 0.001 && metalDevice != nil }

  private func updateLiveLook() {
    let enabled = lookActive && running
    controller.setLiveFrames(enabled)
    if enabled, lookDisplayLink == nil {
      let link = CADisplayLink(target: self, selector: #selector(renderLookFrame))
      link.preferredFramesPerSecond = 30
      link.add(to: .main, forMode: .common)
      lookDisplayLink = link
    } else if !enabled {
      lookDisplayLink?.invalidate()
      lookDisplayLink = nil
      lookView.isHidden = true
      frameLock.lock()
      latestFrame = nil
      frameLock.unlock()
    }
  }

  @objc private func renderLookFrame() {
    frameLock.lock()
    let fresh = latestFrame != nil && CACurrentMediaTime() - latestFrameTime < 0.5
    frameLock.unlock()
    // No frames (e.g. this device can't record and analyse at once): plain preview.
    lookView.isHidden = !fresh
    if fresh { lookView.draw() }
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

  func takeNightPhoto(frames: Int, promise: Promise) {
    controller.captureNight(frames: frames, rotation: captureAngle()) { result in
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

// MARK: - Live look drawing

extension LensCameraView: MTKViewDelegate {
  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  func draw(in view: MTKView) {
    frameLock.lock()
    let frame = latestFrame
    frameLock.unlock()
    guard let frame, let look, let context = lookContext,
          let drawable = view.currentDrawable, let buffer = commandQueue?.makeCommandBuffer() else { return }

    // Aspect-fill the frame into the drawable, like the preview layer.
    let size = view.drawableSize
    let scale = max(size.width / frame.extent.width, size.height / frame.extent.height)
    var image = frame.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    image = image.transformed(by: CGAffineTransform(
      translationX: (size.width - image.extent.width) / 2 - image.extent.minX,
      y: (size.height - image.extent.height) / 2 - image.extent.minY
    ))
    image = Looks.applyLUT(look, intensity: lookIntensity, to: image, context: context)

    let destination = CIRenderDestination(
      width: Int(size.width),
      height: Int(size.height),
      pixelFormat: view.colorPixelFormat,
      commandBuffer: buffer,
      mtlTextureProvider: { drawable.texture }
    )
    _ = try? context.startTask(toRender: image, from: CGRect(origin: .zero, size: size), to: destination, at: .zero)
    buffer.present(drawable)
    buffer.commit()
  }
}
