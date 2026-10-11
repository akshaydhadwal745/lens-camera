import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { ComponentType, forwardRef, Ref } from 'react';
import { NativeSyntheticEvent, Platform, ViewProps } from 'react-native';

export type Lens = 'ultraWide' | 'wide' | 'telephoto';
/** 'timelapse': Android, only where the camera reports it (GPU viewfinder frames into a video encoder). */
export type CameraMode = 'photo' | 'video' | 'night' | 'portrait' | 'timelapse' | 'slowmo';
export type Stabilization = 'off' | 'standard' | 'cinematic' | 'extended';

export type Capabilities = {
  position: 'front' | 'back';
  lens: Lens;
  mode: CameraMode;
  /** Android: slow-motion speed this camera can give (8/4 high-speed, 2 from 60 fps, 0 none) and what is bound now. */
  slowMotionFactor?: number;
  slowMotionBound?: number;
  lenses: { id: Lens; factor: number }[];
  minISO: number;
  maxISO: number;
  minShutter: number;
  maxShutter: number;
  minEV: number;
  maxEV: number;
  minZoom: number;
  maxZoom: number;
  manualExposure: boolean;
  manualFocus: boolean;
  manualWhiteBalance: boolean;
  raw: boolean;
  proRaw: boolean;
  appleLog: boolean;
  hdrVideo: boolean;
  fps60: boolean;
  /** Portrait depth capture available on this camera. */
  depth: boolean;
  /** Max frames for a Night burst (0 = not supported). */
  nightFrames: number;
  flash: boolean;
  /** Android: front camera without a flash lights the face with the screen instead. */
  screenFlash?: boolean;
  torch: boolean;
  /** Modes this camera supports (Android reports it; iOS supports all). */
  modes?: CameraMode[];
  /** Android: what the hardware allows. pro = manual sensor + white balance, basic = auto only. */
  tier?: 'pro' | 'standard' | 'basic';
  /** Android 14+: Ultra HDR photos (JPEG with an HDR gain map). */
  ultraHdr?: boolean;
  /** Android: the maker extension mode bound right now ("none" if none). */
  extension?: LabExtension;
  /** Android: format the photo use case was bound with. */
  photoFormat?: 'jpeg' | 'ultraHdr' | 'raw';
  /** Android diagnostics: photo size bound vs the largest the camera offers, e.g. "4032x3024". */
  photoSize?: string | null;
  maxPhotoSize?: string | null;
  previewSize?: string | null;
  /** Camera2 hardware level (LEGACY / LIMITED / FULL / LEVEL_3 / EXTERNAL). */
  level?: string;
  /** 0 = bound with everything asked for; higher = a fallback combination was needed. */
  bindAttempt?: number;
};

/** Android diagnostics from the native view: preview path, or OpenGL falling back. */
export type CameraDiagnostics =
  | { kind: 'preview'; rotationDegrees: number; targetRotation: number; cameraTransform: boolean; mirroring: boolean; buffer: string }
  | { kind: 'glFallback'; message: string };

export type LabExtension = 'none' | 'auto' | 'hdr' | 'night' | 'bokeh' | 'faceRetouch';

/** One frame of a Quality Lab burst. */
export type BurstFrame = { uri: string; ms: number; iso: number | null; exposureNs: number | null; focusDiopters: number | null };
export type BurstResult = { frames: BurstFrame[]; raw: boolean; extension: LabExtension };

export type CameraStats = {
  iso: number;
  shutter: number;
  temperature: number;
  tint: number;
  lensPosition: number;
  exposureOffset: number;
  zoom: number;
  adjusting: boolean;
  recording: boolean;
  /** Android: the phone's low-light boost is brightening the video right now. */
  lowLightBoost?: boolean;
};

export type AnalysisResult = {
  histogram: number[];
  clipLow: number;
  clipHigh: number;
};

export type AnalysisSettings = {
  peaking: boolean;
  zebra: boolean;
  zebraLevel: number;
  falseColor: boolean;
  histogram: boolean;
};

export type LensCameraProps = ViewProps & {
  active: boolean;
  /** Which camera. (Not `position`: on Android that name collides with the layout style.) */
  facing: 'front' | 'back';
  lens: Lens;
  mode: CameraMode;
  videoResolution: '1080p' | '4k';
  appleLog: boolean;
  hdrVideo: boolean;
  fps: number;
  stabilization: Stabilization;
  /** Live look in the viewfinder (null = none). */
  look: string | null;
  lookIntensity: number;
  /** Android: Portrait blur strength (f-number) for the live background blur in the viewfinder. */
  portraitAperture?: number;
  /** Android, Normal camera: blur strength from how much of the frame the person fills. */
  portraitAuto?: boolean;
  /** Android, Normal camera with no look: suggest a look for the scene (onSceneLook). */
  sceneSuggest?: boolean;
  /** Android: where the camera picture is drawn in the view (fractions [x, y, w, h]); black around it. Default: whole view. */
  frame?: [number, number, number, number];
  /** Android: a Night photo is coming (Night mode or auto Night): show the viewfinder brightened and averaged like the photo. */
  nightPreview?: boolean;
  /** Android: Portrait style previewed live (natural, studio, mono, stage). */
  portraitStyle?: string;
  torch: boolean;
  zoom: number;
  exposureMode: 'auto' | 'manual';
  iso: number;
  shutter: number;
  ev: number;
  whiteBalanceMode: 'auto' | 'manual';
  temperature: number;
  tint: number;
  focusMode: 'auto' | 'manual';
  lensPosition: number;
  /** Android: bind the camera for RAW (DNG) photos (iOS chooses per shot in takePhoto). */
  raw?: boolean;
  /** Android: Ultra HDR photos where supported. */
  hdrPhoto?: boolean;
  /** Android: front-camera photos/videos saved as previewed (mirrored). Default true. */
  mirrorFront?: boolean;
  /** Android: save where photos/videos were taken (opt-in; needs location permission). */
  saveLocation?: boolean;
  /** Android: camera sounds (on by default; silent/vibrate mutes them except where the law requires a shutter sound). */
  shutterSound?: boolean;
  /** Android, Normal video: automatic low-light handling (24–30 fps in the dark, low-light boost where available). */
  autoLowLight?: boolean;
  /** Android, Quality Lab only: bind a phone-maker extension mode in Photo mode. */
  extension?: LabExtension;
  /** Android, Quality Lab only: photo capture tuned for quality (default) or speed. */
  captureMode?: 'quality' | 'latency';
  analysis: AnalysisSettings;
  onReady?: (e: NativeSyntheticEvent<Capabilities>) => void;
  onStats?: (e: NativeSyntheticEvent<CameraStats>) => void;
  onAnalysis?: (e: NativeSyntheticEvent<AnalysisResult>) => void;
  /** `fatal`: the camera couldn't start at all (the app falls back to the basic camera). */
  onError?: (e: NativeSyntheticEvent<{ message: string; fatal?: boolean }>) => void;
  /** Android: how the camera started (anonymous diagnostics). */
  onDiagnostics?: (e: NativeSyntheticEvent<CameraDiagnostics>) => void;
  /** Android: frames are being recorded now (`delayMs` after record was pressed). Show REC from here. */
  onRecordingStarted?: (e: NativeSyntheticEvent<{ delayMs: number }>) => void;
  /** Android: recording sound: 'ok', 'silenced' (mic blocked) or 'error'; `external`: a wired/USB mic. */
  onRecordingAudio?: (e: NativeSyntheticEvent<{ state: 'ok' | 'silenced' | 'error'; external: boolean }>) => void;
  /** Android: a look that suits the scene (or null), from on-phone scene labels. */
  onSceneLook?: (e: NativeSyntheticEvent<{ look: string | null }>) => void;
  /** Android: a burst shot was saved (`count` so far). */
  onBurstShot?: (e: NativeSyntheticEvent<{ count: number }>) => void;
  /** Android: volume keys / camera key / selfie remote take the shot while this camera is on screen. */
  hardwareShutter?: boolean;
  /** Android: a volume/camera key was pressed (with `hardwareShutter`). */
  onHardwareShutter?: () => void;
};

export type PhotoResult = {
  uri: string;
  width: number;
  height: number;
  raw: boolean;
  depth?: boolean;
  frames?: number;
  /** Android Portrait: f-number chosen from the subject's size (Normal camera uses it). */
  autoAperture?: number | null;
  /** Android Portrait: what was separated: 'person', or 'subject' (pet/object, no person found). */
  depthKind?: 'person' | 'subject' | null;
};
export type VideoResult = {
  uri: string;
  duration: number;
  /** Android: ms from start until the first recorded data. */
  startDelayMs?: number | null;
  /** Android, slow motion: how many times slower the clip plays (2, 4 or 8). */
  slowFactor?: number;
};

export type LensCameraHandle = {
  takePhoto(options: { raw: boolean; flash: 'off' | 'on' | 'auto' }): Promise<PhotoResult>;
  /** Night mode: burst of `frames`, aligned and merged on the device. */
  takeNightPhoto(frames: number): Promise<PhotoResult>;
  /** Android, Quality Lab: `frames` shots kept as they are (no merge). */
  takeBurst?(frames: number): Promise<BurstResult>;
  /** Android, self-test: viewfinder frames per second over `ms` (-1 without the GL preview). */
  previewFps?(ms: number): Promise<number>;
  /** Android, Quality Lab: thermal status 0 (none) … 6, or -1 if unknown. */
  thermalStatus?(): Promise<number>;
  /** Resolves when recording stops. */
  startRecording(): Promise<VideoResult>;
  stopRecording(): Promise<void>;
  /** Android: pause/resume the current recording (one file; paused time isn't recorded). */
  pauseRecording?(): Promise<boolean>;
  /** Android, Photo mode: hold-the-shutter burst; resolves after stopBurst() with the shots and the best one. */
  startBurst?(max: number): Promise<{ frames: { uri: string; width: number; height: number }[]; pick: number }>;
  stopBurst?(): Promise<void>;
  /** Android, while recording: a photo (full resolution where supported, else the video frame: `fromVideo`). */
  takeVideoPhoto?(): Promise<PhotoResult & { fromVideo?: boolean }>;
  /** Android, mode 'timelapse': resolves with the clip when stopTimeLapse() finishes it. */
  startTimeLapse?(): Promise<{ uri: string; duration: number; frames: number }>;
  stopTimeLapse?(): Promise<void>;
  resumeRecording?(): Promise<boolean>;
  focusAt(x: number, y: number): Promise<void>;
  /** Android: long-press lock at x/y (fractions of the view); resolves what this camera could lock. */
  lockFocus?(x: number, y: number): Promise<{ af: boolean; ae: boolean }>;
  /** Android: release the lock (continuous auto focus/exposure again). */
  unlockFocus?(): Promise<void>;
};

type CameraModule = {
  /** Android: everything known about this phone's cameras (Camera info screen). */
  deviceReport?: () => Promise<Record<string, unknown>>;
};

const cameraModule = Platform.OS === 'web' ? null : requireOptionalNativeModule<CameraModule>('LensCamera');

/** True in development/production builds that include the native module (not Expo Go / web). */
export const isProCameraAvailable = cameraModule != null;

/** Android: camera hardware report, or null where not available. */
export async function cameraDeviceReport(): Promise<Record<string, unknown> | null> {
  return cameraModule?.deviceReport ? cameraModule.deviceReport() : null;
}

const NativeView: ComponentType<LensCameraProps & { ref?: Ref<LensCameraHandle> }> | null = isProCameraAvailable
  ? requireNativeView('LensCamera')
  : null;

export const LensCameraView = forwardRef<LensCameraHandle, LensCameraProps>(function LensCameraView(props, ref) {
  if (!NativeView) return null;
  return <NativeView {...props} ref={ref} />;
});

// ---------- Imaging (edits, looks, export) ----------

export type RenderResult = { uri: string; width: number; height: number };

type ImagingModule = {
  looks: string[];
  renderImage(uri: string, recipe: object | null, options: { maxPixel?: number; format?: 'heic' | 'jpeg'; quality?: number }): Promise<RenderResult>;
  exportVideo(uri: string, recipe: object | null): Promise<{ uri: string }>;
  hasDepth(uri: string): Promise<boolean>;
  /**
   * Plays a video with its look (colour part of the edit), live on the GPU:
   * the same shader as exportVideo, on expo-video's player. Android only;
   * missing in APKs before dev-43.
   */
  setVideoLook?(player: object, recipe: object | null): Promise<void>;
};

const imaging = Platform.OS === 'web' ? null : requireOptionalNativeModule<ImagingModule>('LensImaging');

/** True when on-device editing/looks are available (dev/production builds, not Expo Go). */
export const isImagingAvailable = imaging != null;

export const LensImaging = imaging;

export type LensEditViewProps = ViewProps & {
  uri: string;
  recipe: object | null;
  showOriginal?: boolean;
  onRenderError?: (e: NativeSyntheticEvent<{ message: string }>) => void;
};

const NativeEditView: ComponentType<LensEditViewProps> | null = isImagingAvailable ? requireNativeView('LensImaging') : null;

export function LensEditView(props: LensEditViewProps) {
  if (!NativeEditView) return null;
  return <NativeEditView {...props} />;
}
