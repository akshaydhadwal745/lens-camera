import AVFoundation
import CoreImage
import ImageIO
import UIKit
import Vision

/// Everything the JS side can configure. Structural fields (position, lens,
/// mode, resolution, log) rebuild the session; the rest are applied live.
struct CameraConfig: Equatable {
  var position: AVCaptureDevice.Position = .back
  var lens = "wide"            // ultraWide | wide | telephoto
  var mode = "photo"           // photo | video | night | portrait
  var videoResolution = "4k"   // 1080p | 4k
  var appleLog = false
  var hdrVideo = false         // 10-bit HLG (Dolby Vision–compatible) when supported
  var fps = 30                 // 24 | 30 | 60
  var stabilization = "cinematic" // off | standard | cinematic | extended
  var torch = false
  var zoom: Double = 1
  var exposureMode = "auto"    // auto | manual
  var iso: Double = 0          // 0 = keep current
  var shutter: Double = 0      // seconds, 0 = keep current
  var ev: Double = 0
  var whiteBalanceMode = "auto"
  var temperature: Double = 5500
  var tint: Double = 0
  var focusMode = "auto"
  var lensPosition: Double = 0.5

  func needsRebuild(from old: CameraConfig) -> Bool {
    position != old.position || lens != old.lens || mode != old.mode
      || videoResolution != old.videoResolution || appleLog != old.appleLog
      || hdrVideo != old.hdrVideo || fps != old.fps || stabilization != old.stabilization
  }

  /// Photo, Night and Portrait all use the still-photo pipeline.
  var isStillMode: Bool { mode != "video" }
}

enum CameraError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    switch self {
    case .message(let m): return m
    }
  }
}

/// Several frames captured for Night mode, merged when all have arrived.
private final class NightRequest {
  let completion: (Result<[String: Any], Error>) -> Void
  var frames: [CIImage] = []
  var error: Error?
  init(_ completion: @escaping (Result<[String: Any], Error>) -> Void) { self.completion = completion }
}

private final class PhotoRequest {
  let completion: (Result<[String: Any], Error>) -> Void
  /** File extension for the processed (non-RAW) photo. */
  let processedExtension: String
  var result: [String: Any]?
  var error: Error?
  init(processedExtension: String, _ completion: @escaping (Result<[String: Any], Error>) -> Void) {
    self.processedExtension = processedExtension
    self.completion = completion
  }
}

/// Owns the AVCaptureSession. All session/device work happens on `sessionQueue`;
/// callbacks to the view are delivered on the main queue.
final class CameraController: NSObject {
  let session = AVCaptureSession()

  var onReady: (([String: Any]) -> Void)?
  var onError: ((String) -> Void)?
  var onAnalysis: ((FrameAnalysis) -> Void)?
  /// Live preview frames (upright, mirrored like the preview) while a look is active.
  var onPreviewFrame: ((CIImage) -> Void)?

  private let sessionQueue = DispatchQueue(label: "lens.camera.session")
  private let analysisQueue = DispatchQueue(label: "lens.camera.analysis", qos: .userInitiated)
  private let photoOutput = AVCapturePhotoOutput()
  private let movieOutput = AVCaptureMovieFileOutput()
  private let dataOutput = AVCaptureVideoDataOutput()
  private let analyzer = FrameAnalyzer()

  private var config = CameraConfig()
  private var built = false
  private var videoInput: AVCaptureDeviceInput?
  private var audioInput: AVCaptureDeviceInput?
  private(set) var device: AVCaptureDevice?

  private let lock = NSLock()
  private var photoRequests: [Int64: PhotoRequest] = [:]
  private var nightRequests: [Int64: NightRequest] = [:]
  private var liveFrames = false
  private var recordingCompletion: ((Result<[String: Any], Error>) -> Void)?

  // Analysis state (touched only on analysisQueue).
  private var analysisOptions = AnalysisOptions()
  private var lastAnalysis: CFTimeInterval = 0

  // MARK: Lifecycle

  func start(with newConfig: CameraConfig) {
    sessionQueue.async {
      let old = self.config
      self.config = newConfig
      if !self.built || newConfig.needsRebuild(from: old) {
        self.rebuild()
      }
      self.applyDeviceSettings()
      if !self.session.isRunning {
        self.session.startRunning()
      }
    }
  }

  func update(_ newConfig: CameraConfig) {
    sessionQueue.async {
      let old = self.config
      self.config = newConfig
      guard self.built else { return }
      if newConfig.needsRebuild(from: old) {
        self.rebuild()
      }
      self.applyDeviceSettings()
    }
  }

  func stop() {
    sessionQueue.async {
      if self.movieOutput.isRecording { self.movieOutput.stopRecording() }
      if self.session.isRunning { self.session.stopRunning() }
    }
  }

  func setAnalysis(_ options: AnalysisOptions) {
    analysisQueue.async { self.analysisOptions = options }
  }

  /// Turns on per-frame delivery for the live look preview.
  func setLiveFrames(_ enabled: Bool) {
    analysisQueue.async { self.liveFrames = enabled }
  }

  // MARK: Session building

  private func findDevice() -> AVCaptureDevice? {
    if config.mode == "portrait" {
      // Depth needs a multi-camera (or TrueDepth) device.
      if config.position == .front {
        return AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front)
          ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
      }
      return AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInDualCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
    }
    if config.position == .front {
      return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
    }
    let type: AVCaptureDevice.DeviceType
    switch config.lens {
    case "ultraWide": type = .builtInUltraWideCamera
    case "telephoto": type = .builtInTelephotoCamera
    default: type = .builtInWideAngleCamera
    }
    return AVCaptureDevice.default(type, for: .video, position: .back)
      ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
  }

  private func rebuild() {
    guard let newDevice = findDevice() else {
      report("No camera available on this device.")
      return
    }

    session.beginConfiguration()

    if let input = videoInput {
      session.removeInput(input)
      videoInput = nil
    }
    do {
      let input = try AVCaptureDeviceInput(device: newDevice)
      guard session.canAddInput(input) else {
        session.commitConfiguration()
        report("Could not use this camera.")
        return
      }
      session.addInput(input)
      videoInput = input
      device = newDevice
    } catch {
      session.commitConfiguration()
      report("Camera error: \(error.localizedDescription)")
      return
    }

    let useLog = config.mode == "video" && config.appleLog
    let useHDR = config.mode == "video" && config.hdrVideo && !useLog
    session.automaticallyConfiguresCaptureDeviceForWideColor = !(useLog || useHDR)

    if config.isStillMode {
      if session.outputs.contains(movieOutput) { session.removeOutput(movieOutput) }
      if let mic = audioInput {
        session.removeInput(mic)
        audioInput = nil
      }
      if !session.outputs.contains(photoOutput), session.canAddOutput(photoOutput) {
        session.addOutput(photoOutput)
      }
      if session.canSetSessionPreset(.photo) { session.sessionPreset = .photo }
    } else {
      if session.outputs.contains(photoOutput) { session.removeOutput(photoOutput) }
      // Recording takes priority over analysis frames: re-add the analysis
      // output afterwards, and only if the hardware allows both at once.
      if session.outputs.contains(dataOutput) { session.removeOutput(dataOutput) }
      if !session.outputs.contains(movieOutput), session.canAddOutput(movieOutput) {
        session.addOutput(movieOutput)
      }
      if audioInput == nil,
         AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
         let mic = AVCaptureDevice.default(for: .audio),
         let micInput = try? AVCaptureDeviceInput(device: mic),
         session.canAddInput(micInput) {
        session.addInput(micInput)
        audioInput = micInput
      }
      let preset: AVCaptureSession.Preset = config.videoResolution == "4k" ? .hd4K3840x2160 : .hd1920x1080
      session.sessionPreset = session.canSetSessionPreset(preset) ? preset : .high
    }

    if !session.outputs.contains(dataOutput), session.canAddOutput(dataOutput) {
      dataOutput.alwaysDiscardsLateVideoFrames = true
      session.addOutput(dataOutput)
    }

    session.commitConfiguration()

    if config.mode == "video" { configureVideoFormat(on: newDevice) }
    configureOutputs(for: newDevice)
    built = true

    let capabilities = describeCapabilities(newDevice)
    DispatchQueue.main.async { self.onReady?(capabilities) }
  }

  /// Picks a capture format for the requested resolution / frame rate /
  /// colour (Apple Log or HDR). Without special requests the session preset is used.
  private func configureVideoFormat(on device: AVCaptureDevice) {
    let wantedWidth: Int32 = config.videoResolution == "4k" ? 3840 : 1920
    let fps = Double(max(1, config.fps))
    let wantLog = config.appleLog
    let wantHDR = config.hdrVideo && !wantLog
    guard wantLog || wantHDR || fps > 30 || fps < 30 else { return }

    var candidates = device.formats.filter { format in
      CMVideoFormatDescriptionGetDimensions(format.formatDescription).width == wantedWidth
        && format.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= fps && $0.minFrameRate <= fps }
    }
    var colorSpace: AVCaptureColorSpace?
    if wantLog {
      if #available(iOS 17.0, *) {
        candidates = candidates.filter { $0.supportedColorSpaces.contains(.appleLog) }
        colorSpace = .appleLog
      } else {
        candidates = []
      }
    } else if wantHDR {
      candidates = candidates.filter { $0.supportedColorSpaces.contains(.HLG_BT2020) }
      colorSpace = .HLG_BT2020
    }
    guard let format = candidates.last else {
      report("This camera can't record \(config.videoResolution == "4k" ? "4K" : "1080p") at \(Int(fps)) fps\(wantLog ? " in Apple Log" : wantHDR ? " in HDR" : ""). Using the closest available setting.")
      return
    }
    do {
      try device.lockForConfiguration()
      device.activeFormat = format
      if let colorSpace { device.activeColorSpace = colorSpace }
      let duration = CMTime(value: 1, timescale: CMTimeScale(fps))
      device.activeVideoMinFrameDuration = duration
      device.activeVideoMaxFrameDuration = duration
      device.unlockForConfiguration()
    } catch {
      report("Could not set the video format: \(error.localizedDescription)")
    }
  }

  private func configureOutputs(for device: AVCaptureDevice) {
    // Analysis frames: prefer 8-bit full range luma.
    let preferred = kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
    let available = dataOutput.availableVideoPixelFormatTypes
    if available.contains(preferred) {
      dataOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: preferred]
    }
    dataOutput.setSampleBufferDelegate(self, queue: analysisQueue)
    if let connection = dataOutput.connection(with: .video), connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = config.position == .front
    }

    if session.outputs.contains(photoOutput) {
      photoOutput.maxPhotoQualityPrioritization = .quality
      let portrait = config.mode == "portrait"
      photoOutput.isDepthDataDeliveryEnabled = portrait && photoOutput.isDepthDataDeliverySupported
      photoOutput.isPortraitEffectsMatteDeliveryEnabled = portrait && photoOutput.isPortraitEffectsMatteDeliverySupported
      if photoOutput.isAppleProRAWSupported {
        photoOutput.isAppleProRAWEnabled = !portrait
      }
      if let largest = device.activeFormat.supportedMaxPhotoDimensions.last {
        photoOutput.maxPhotoDimensions = largest
      }
    }

    if session.outputs.contains(movieOutput), let connection = movieOutput.connection(with: .video) {
      if movieOutput.availableVideoCodecTypes.contains(.hevc) {
        movieOutput.setOutputSettings([AVVideoCodecKey: AVVideoCodecType.hevc], for: connection)
      }
      if connection.isVideoStabilizationSupported {
        let wanted: AVCaptureVideoStabilizationMode
        switch config.stabilization {
        case "off": wanted = .off
        case "standard": wanted = .standard
        case "extended": wanted = .cinematicExtended
        default: wanted = .cinematic
        }
        let fallbacks: [AVCaptureVideoStabilizationMode] = [wanted, .cinematic, .standard, .auto]
        let mode = fallbacks.first { device.activeFormat.isVideoStabilizationModeSupported($0) } ?? .auto
        connection.preferredVideoStabilizationMode = wanted == .off ? .off : mode
      }
    }
  }

  /// Rotates analysis frames to match the preview (so overlays line up).
  func setAnalysisRotation(_ angle: CGFloat) {
    sessionQueue.async {
      guard let connection = self.dataOutput.connection(with: .video) else { return }
      if #available(iOS 17.0, *) {
        if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
      } else if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
    }
  }

  // MARK: Capabilities & stats

  private static func fieldOfView(_ type: AVCaptureDevice.DeviceType) -> Float? {
    AVCaptureDevice.default(type, for: .video, position: .back)?.activeFormat.videoFieldOfView
  }

  private func describeCapabilities(_ d: AVCaptureDevice) -> [String: Any] {
    var lenses: [[String: Any]] = []
    if config.position == .back, let wideFov = Self.fieldOfView(.builtInWideAngleCamera) {
      let wideHalf = tan(Double(wideFov) * .pi / 360)
      let types: [(String, AVCaptureDevice.DeviceType)] = [
        ("ultraWide", .builtInUltraWideCamera),
        ("wide", .builtInWideAngleCamera),
        ("telephoto", .builtInTelephotoCamera),
      ]
      for (id, type) in types {
        guard let fov = Self.fieldOfView(type) else { continue }
        let factor = wideHalf / tan(Double(fov) * .pi / 360)
        lenses.append(["id": id, "factor": (factor * 10).rounded() / 10])
      }
    }
    let f = d.activeFormat
    var supportsLog = false
    if #available(iOS 17.0, *) {
      supportsLog = d.formats.contains { $0.supportedColorSpaces.contains(.appleLog) }
    }
    return [
      "position": config.position == .front ? "front" : "back",
      "lens": config.position == .front ? "wide" : config.lens,
      "mode": config.mode,
      "lenses": lenses,
      "minISO": Double(f.minISO),
      "maxISO": Double(f.maxISO),
      "minShutter": CMTimeGetSeconds(f.minExposureDuration),
      "maxShutter": min(CMTimeGetSeconds(f.maxExposureDuration), 1.0),
      "minEV": Double(d.minExposureTargetBias),
      "maxEV": Double(d.maxExposureTargetBias),
      "minZoom": Double(d.minAvailableVideoZoomFactor),
      "maxZoom": Double(min(d.maxAvailableVideoZoomFactor, 15)),
      "manualExposure": d.isExposureModeSupported(.custom),
      "manualFocus": d.isLockingFocusWithCustomLensPositionSupported,
      "manualWhiteBalance": d.isLockingWhiteBalanceWithCustomDeviceGainsSupported,
      "raw": session.outputs.contains(photoOutput) && !photoOutput.availableRawPhotoPixelFormatTypes.isEmpty,
      "proRaw": session.outputs.contains(photoOutput) && photoOutput.isAppleProRAWSupported,
      "appleLog": supportsLog,
      "hdrVideo": d.formats.contains { $0.supportedColorSpaces.contains(.HLG_BT2020) },
      "fps60": d.formats.contains { $0.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= 60 } },
      "depth": session.outputs.contains(photoOutput) && photoOutput.isDepthDataDeliverySupported,
      "nightFrames": session.outputs.contains(photoOutput) ? photoOutput.maxBracketedCapturePhotoCount : 0,
      "flash": d.hasFlash,
      "torch": d.hasTorch,
    ]
  }

  /// Current auto/manual values for the HUD.
  func stats() -> [String: Any]? {
    guard let d = device else { return nil }
    let tt = d.temperatureAndTintValues(for: d.deviceWhiteBalanceGains)
    return [
      "iso": Double(d.iso),
      "shutter": CMTimeGetSeconds(d.exposureDuration),
      "temperature": Double(tt.temperature),
      "tint": Double(tt.tint),
      "lensPosition": Double(d.lensPosition),
      "exposureOffset": Double(d.exposureTargetOffset),
      "zoom": Double(d.videoZoomFactor),
      "adjusting": d.isAdjustingFocus || d.isAdjustingExposure,
      "recording": movieOutput.isRecording,
    ]
  }

  // MARK: Live device settings

  private func applyDeviceSettings() {
    guard let d = device else { return }
    do {
      try d.lockForConfiguration()
    } catch {
      return
    }
    defer { d.unlockForConfiguration() }

    let maxZoom = min(d.maxAvailableVideoZoomFactor, 15)
    d.videoZoomFactor = max(d.minAvailableVideoZoomFactor, min(CGFloat(config.zoom), maxZoom))

    let format = d.activeFormat
    if config.exposureMode == "manual", d.isExposureModeSupported(.custom) {
      let iso = config.iso > 0 ? Float(config.iso) : d.iso
      let clampedISO = max(format.minISO, min(format.maxISO, iso))
      var duration = config.shutter > 0
        ? CMTime(seconds: config.shutter, preferredTimescale: 1_000_000)
        : d.exposureDuration
      duration = CMTimeMaximum(format.minExposureDuration, CMTimeMinimum(format.maxExposureDuration, duration))
      d.setExposureModeCustom(duration: duration, iso: clampedISO, completionHandler: nil)
    } else {
      if d.isExposureModeSupported(.continuousAutoExposure), d.exposureMode != .continuousAutoExposure {
        d.exposureMode = .continuousAutoExposure
      }
      let bias = max(d.minExposureTargetBias, min(d.maxExposureTargetBias, Float(config.ev)))
      d.setExposureTargetBias(bias, completionHandler: nil)
    }

    if config.whiteBalanceMode == "manual", d.isLockingWhiteBalanceWithCustomDeviceGainsSupported {
      let values = AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(
        temperature: Float(config.temperature),
        tint: Float(config.tint)
      )
      var gains = d.deviceWhiteBalanceGains(for: values)
      let maxGain = d.maxWhiteBalanceGain
      gains.redGain = max(1, min(maxGain, gains.redGain))
      gains.greenGain = max(1, min(maxGain, gains.greenGain))
      gains.blueGain = max(1, min(maxGain, gains.blueGain))
      d.setWhiteBalanceModeLocked(with: gains, completionHandler: nil)
    } else if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance), d.whiteBalanceMode != .continuousAutoWhiteBalance {
      d.whiteBalanceMode = .continuousAutoWhiteBalance
    }

    if config.focusMode == "manual", d.isLockingFocusWithCustomLensPositionSupported {
      d.setFocusModeLocked(lensPosition: Float(max(0, min(1, config.lensPosition))), completionHandler: nil)
    } else if d.isFocusModeSupported(.continuousAutoFocus), d.focusMode != .continuousAutoFocus {
      d.focusMode = .continuousAutoFocus
    }

    if d.hasTorch {
      let wanted: AVCaptureDevice.TorchMode = (config.torch && config.mode == "video") ? .on : .off
      if d.torchMode != wanted, d.isTorchModeSupported(wanted) { d.torchMode = wanted }
    }
  }

  /// Point in device coordinates (0...1, from the preview layer).
  func focus(at point: CGPoint) {
    sessionQueue.async {
      guard let d = self.device, (try? d.lockForConfiguration()) != nil else { return }
      defer { d.unlockForConfiguration() }
      if self.config.focusMode == "auto", d.isFocusPointOfInterestSupported {
        d.focusPointOfInterest = point
        if d.isFocusModeSupported(.continuousAutoFocus) { d.focusMode = .continuousAutoFocus }
      }
      if self.config.exposureMode == "auto", d.isExposurePointOfInterestSupported {
        d.exposurePointOfInterest = point
        if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
      }
    }
  }

  // MARK: Photo

  private func preferredRawFormat() -> OSType? {
    let types = photoOutput.availableRawPhotoPixelFormatTypes
    if photoOutput.isAppleProRAWEnabled, let proRaw = types.first(where: { AVCapturePhotoOutput.isAppleProRAWPixelFormat($0) }) {
      return proRaw
    }
    return types.first(where: { AVCapturePhotoOutput.isBayerRAWPixelFormat($0) })
  }

  func capturePhoto(raw: Bool, flash: String, rotation: CGFloat?, completion: @escaping (Result<[String: Any], Error>) -> Void) {
    sessionQueue.async {
      guard self.session.isRunning, self.session.outputs.contains(self.photoOutput) else {
        completion(.failure(CameraError.message("Switch to photo mode to take a photo.")))
        return
      }

      let settings: AVCapturePhotoSettings
      var isRaw = false
      var processedExtension = "jpg"
      if raw, self.config.mode != "portrait", let rawFormat = self.preferredRawFormat() {
        settings = AVCapturePhotoSettings(rawPixelFormatType: rawFormat)
        isRaw = true
      } else {
        // HEIC is the camera's native output on iPhone: about half the size of
        // JPEG at the same quality. JPEG only if HEVC isn't available.
        let codec: AVVideoCodecType = self.photoOutput.availablePhotoCodecTypes.contains(.hevc) ? .hevc : .jpeg
        settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: codec])
        settings.photoQualityPrioritization = .quality
        processedExtension = codec == .hevc ? "heic" : "jpg"
      }
      if self.config.mode == "portrait", !isRaw {
        if self.photoOutput.isDepthDataDeliveryEnabled {
          settings.isDepthDataDeliveryEnabled = true
          settings.embedsDepthDataInPhoto = true
        }
        if self.photoOutput.isPortraitEffectsMatteDeliveryEnabled {
          settings.isPortraitEffectsMatteDeliveryEnabled = true
          settings.embedsPortraitEffectsMatteInPhoto = true
        }
      }
      let maxDimensions = self.photoOutput.maxPhotoDimensions
      if maxDimensions.width > 0 && maxDimensions.height > 0 {
        settings.maxPhotoDimensions = maxDimensions
      }

      let flashMode: AVCaptureDevice.FlashMode = flash == "on" ? .on : flash == "auto" ? .auto : .off
      if !isRaw, self.photoOutput.supportedFlashModes.contains(flashMode) {
        settings.flashMode = flashMode
      }

      if let connection = self.photoOutput.connection(with: .video) {
        if let rotation {
          if #available(iOS 17.0, *) {
            if connection.isVideoRotationAngleSupported(rotation) { connection.videoRotationAngle = rotation }
          }
        }
        if connection.isVideoMirroringSupported {
          connection.automaticallyAdjustsVideoMirroring = false
          connection.isVideoMirrored = self.config.position == .front
        }
      }

      self.lock.lock()
      self.photoRequests[settings.uniqueID] = PhotoRequest(processedExtension: processedExtension, completion)
      self.lock.unlock()
      self.photoOutput.capturePhoto(with: settings, delegate: self)
    }
  }

  // MARK: Night mode

  /// Captures a burst of frames and merges them (aligned + averaged) into one
  /// low-noise photo. Hold the phone steady; works best with a slow shutter.
  func captureNight(frames requested: Int, rotation: CGFloat?, completion: @escaping (Result<[String: Any], Error>) -> Void) {
    sessionQueue.async {
      guard self.session.isRunning, self.session.outputs.contains(self.photoOutput) else {
        completion(.failure(CameraError.message("Switch to Night mode to take a night photo.")))
        return
      }
      let maxCount = self.photoOutput.maxBracketedCapturePhotoCount
      let count = max(2, min(requested, maxCount))
      guard maxCount >= 2 else {
        completion(.failure(CameraError.message("This camera can't capture bursts for Night mode.")))
        return
      }
      let brackets = (0..<count).map { _ in
        AVCaptureAutoExposureBracketedStillImageSettings.autoExposureSettings(exposureTargetBias: 0)
      }
      let settings = AVCapturePhotoBracketSettings(
        rawPixelFormatType: 0,
        processedFormat: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA],
        bracketedSettings: brackets
      )
      if self.photoOutput.isLensStabilizationDuringBracketedCaptureSupported {
        settings.isLensStabilizationEnabled = true
      }
      if let connection = self.photoOutput.connection(with: .video) {
        if let rotation {
          if #available(iOS 17.0, *) {
            if connection.isVideoRotationAngleSupported(rotation) { connection.videoRotationAngle = rotation }
          }
        }
        if connection.isVideoMirroringSupported {
          connection.automaticallyAdjustsVideoMirroring = false
          connection.isVideoMirrored = self.config.position == .front
        }
      }
      self.lock.lock()
      self.nightRequests[settings.uniqueID] = NightRequest(completion)
      self.lock.unlock()
      self.photoOutput.capturePhoto(with: settings, delegate: self)
    }
  }

  private static func mergeNight(_ frames: [CIImage]) throws -> [String: Any] {
    guard let reference = frames.first else { throw CameraError.message("No frames captured.") }
    var sum = reference
    for frame in frames.dropFirst() {
      var aligned = frame
      let request = VNTranslationalImageRegistrationRequest(targetedCIImage: frame)
      try? VNImageRequestHandler(ciImage: reference).perform([request])
      if let observation = request.results?.first as? VNImageTranslationAlignmentObservation {
        aligned = frame.transformed(by: observation.alignmentTransform)
      }
      sum = aligned.applyingFilter("CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: sum])
    }
    let n = CGFloat(frames.count)
    let averaged = sum.applyingFilter("CIColorMatrix", parameters: [
      "inputRVector": CIVector(x: 1 / n, y: 0, z: 0, w: 0),
      "inputGVector": CIVector(x: 0, y: 1 / n, z: 0, w: 0),
      "inputBVector": CIVector(x: 0, y: 0, z: 1 / n, w: 0),
      "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1 / n),
    ])
    // Trim the edges where shifted frames don't overlap.
    let inset = reference.extent.insetBy(dx: reference.extent.width * 0.015, dy: reference.extent.height * 0.015)
    let merged = averaged.cropped(to: inset)
      .applyingFilter("CINoiseReduction", parameters: ["inputNoiseLevel": 0.01, "inputSharpness": 0.5])
      .transformed(by: CGAffineTransform(translationX: -inset.minX, y: -inset.minY))

    let pipeline = ImagePipeline.shared
    let space = CGColorSpace(name: CGColorSpace.displayP3) ?? CGColorSpaceCreateDeviceRGB()
    let quality = CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String)
    guard let data = pipeline.context.heifRepresentation(of: merged, format: .RGBA8, colorSpace: space, options: [quality: 0.92]) else {
      throw CameraError.message("Could not encode the night photo.")
    }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("lens-night-\(UUID().uuidString).heic")
    try data.write(to: url)
    return ["uri": url.absoluteString, "width": Int(merged.extent.width), "height": Int(merged.extent.height), "raw": false, "depth": false, "frames": frames.count]
  }

  // MARK: Video

  func startRecording(rotation: CGFloat?, completion: @escaping (Result<[String: Any], Error>) -> Void) {
    sessionQueue.async {
      guard self.session.isRunning, self.session.outputs.contains(self.movieOutput) else {
        completion(.failure(CameraError.message("Switch to video mode to record.")))
        return
      }
      guard !self.movieOutput.isRecording else {
        completion(.failure(CameraError.message("Already recording.")))
        return
      }
      if let connection = self.movieOutput.connection(with: .video) {
        if let rotation {
          if #available(iOS 17.0, *) {
            if connection.isVideoRotationAngleSupported(rotation) { connection.videoRotationAngle = rotation }
          }
        }
        if connection.isVideoMirroringSupported {
          connection.automaticallyAdjustsVideoMirroring = false
          connection.isVideoMirrored = self.config.position == .front
        }
      }
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("lens-\(UUID().uuidString).mov")
      self.recordingCompletion = completion
      self.movieOutput.startRecording(to: url, recordingDelegate: self)
    }
  }

  func stopRecording() {
    sessionQueue.async {
      if self.movieOutput.isRecording { self.movieOutput.stopRecording() }
    }
  }

  // MARK: Helpers

  private func report(_ message: String) {
    DispatchQueue.main.async { self.onError?(message) }
  }
}

// MARK: - Photo delegate

extension CameraController: AVCapturePhotoCaptureDelegate {
  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    lock.lock()
    let night = nightRequests[photo.resolvedSettings.uniqueID]
    let request = photoRequests[photo.resolvedSettings.uniqueID]
    lock.unlock()
    if let night {
      if let error {
        night.error = error
      } else if let buffer = photo.pixelBuffer {
        let orientation = (photo.metadata[kCGImagePropertyOrientation as String] as? NSNumber)?.int32Value ?? 1
        night.frames.append(CIImage(cvPixelBuffer: buffer).oriented(forExifOrientation: orientation))
      }
      return
    }
    guard let request else { return }

    if let error {
      request.error = error
      return
    }
    guard let data = photo.fileDataRepresentation() else {
      request.error = CameraError.message("Could not encode the photo.")
      return
    }
    let ext = photo.isRawPhoto ? "dng" : request.processedExtension
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("lens-\(UUID().uuidString).\(ext)")
    do {
      try data.write(to: url)
    } catch {
      request.error = error
      return
    }
    let dims = photo.isRawPhoto ? photo.resolvedSettings.rawPhotoDimensions : photo.resolvedSettings.photoDimensions
    request.result = [
      "uri": url.absoluteString,
      "width": Int(dims.width),
      "height": Int(dims.height),
      "raw": photo.isRawPhoto,
      "depth": photo.depthData != nil,
    ]
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
    lock.lock()
    let night = nightRequests.removeValue(forKey: resolvedSettings.uniqueID)
    let request = photoRequests.removeValue(forKey: resolvedSettings.uniqueID)
    lock.unlock()
    if let night {
      if let failure = error ?? night.error, night.frames.isEmpty {
        night.completion(.failure(failure))
        return
      }
      let frames = night.frames
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          night.completion(.success(try CameraController.mergeNight(frames)))
        } catch {
          night.completion(.failure(error))
        }
      }
      return
    }
    guard let request else { return }

    if let result = request.result {
      request.completion(.success(result))
    } else {
      request.completion(.failure(error ?? request.error ?? CameraError.message("Capture failed.")))
    }
  }
}

// MARK: - Recording delegate

extension CameraController: AVCaptureFileOutputRecordingDelegate {
  func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
    let completion = recordingCompletion
    recordingCompletion = nil
    var succeeded = error == nil
    if let nsError = error as NSError?,
       let finished = nsError.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool {
      succeeded = finished
    }
    if succeeded {
      completion?(.success([
        "uri": outputFileURL.absoluteString,
        "duration": CMTimeGetSeconds(output.recordedDuration),
      ]))
    } else {
      completion?(.failure(error ?? CameraError.message("Recording failed.")))
    }
  }
}

// MARK: - Analysis frames

extension CameraController: AVCaptureVideoDataOutputSampleBufferDelegate {
  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    if liveFrames, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
      onPreviewFrame?(CIImage(cvPixelBuffer: buffer))
    }
    let options = analysisOptions
    guard options.needsAnything else { return }
    let now = CACurrentMediaTime()
    guard now - lastAnalysis >= 1.0 / 12.0 else { return }
    lastAnalysis = now
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let result = analyzer.analyze(pixelBuffer, options: options)
    DispatchQueue.main.async { self.onAnalysis?(result) }
  }
}
