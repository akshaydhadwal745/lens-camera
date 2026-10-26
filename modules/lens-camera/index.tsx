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
  /** EV step the camera applies (Android; e.g. 0.5 on the Galaxy S8, 1/3 on many phones). */
  evStep?: number;
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
  /** Android: photos can carry a motion clip (GPU viewfinder can feed an encoder). */
  motionPhoto?: boolean;
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

/** A QR code seen in the viewfinder. */
export type ScannedCode = {
  kind: 'url' | 'wifi' | 'phone' | 'email' | 'text';
  value: string;
  url?: string;
  ssid?: string | null;
  password?: string | null;
  phone?: string | null;
  email?: string | null;
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
  /** Android, Photo mode: look for QR codes in the viewfinder (onCode). */
  scanCodes?: boolean;
  /** Android, Photo mode: photos carry the ~3 s around the shot (Google Motion Photo format). */
  motionPhoto?: boolean;
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
  /**
   * Android: photo capture path: auto (default: quick path in normal light, best quality when
   * dim; Photo mode, plain JPEG), best quality, the phone's quick path, or zero shutter lag
   * where supported (else quick). docs/design/switch-features.md §1.
   */
  captureMode?: 'auto' | 'quality' | 'latency' | 'zsl';
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
  /** Android: a QR code came into view (or left it: null). */
  onCode?: (e: NativeSyntheticEvent<{ code: ScannedCode | null }>) => void;
  /** Android, during a time-lapse: the phone started/stopped being carried (hyperlapse: frames closer together). */
  onTimeLapse?: (e: NativeSyntheticEvent<{ hyperlapse: boolean }>) => void;
  /** Android: this phone's encoder can't keep up with motion photos (they were turned off). */
  onMotionUnavailable?: () => void;
  /** Android: a photo's frame was captured (still being saved): the shutter may take the next one. */
  onCaptureStarted?: () => void;
  /** Android: how the phone is held, degrees turned clockwise (0/90/180/270). The app is portrait-only: icons turn instead. */
  onDeviceOrientation?: (e: NativeSyntheticEvent<{ degrees: number }>) => void;
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
  /** Android Night: the maker's Night didn't answer, so this was taken with Lens Night instead. */
  nightFallback?: boolean;
  /** Android Portrait: f-number chosen from the subject's size (Normal camera uses it). */
  autoAperture?: number | null;
  /** Android: the photo carries a motion clip (Motion on, Photo mode). */
  motion?: boolean;
  /** Android Portrait: what was separated: 'person', or 'subject' (pet/object, no person found). */
  depthKind?: 'person' | 'subject' | null;
  /** Android: ms from the press until the frame was captured (shutter lag). */
  lagMs?: number | null;
  /** Android: ms from the press until the file was saved. */
  savedMs?: number;
  /** Android: the capture path used ('zsl' only where the camera supports it). */
  captureMode?: 'quality' | 'latency' | 'zsl';
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
  /** Android: would an Astro stack (long exposures) work right now? Its plan, or null. */
  astroPlan?(): Promise<{ iso: number; exposureNs: number; frames: number; seconds: number } | null>;
  /** Android: long exposures aligned and stacked (sky at night, on a tripod). */
  takeAstroPhoto?(): Promise<PhotoResult & { astro?: number }>;
  takeNightPhoto(frames: number): Promise<PhotoResult>;
  /** Android, Quality Lab: `frames` shots kept as they are (no merge). */
  takeBurst?(frames: number): Promise<BurstResult>;
  /** Android, self-test: viewfinder frames per second over `ms` (-1 without the GL preview). */
  previewFps?(ms: number): Promise<number>;
  /** Android self-test (dev-68+): frames shown/delivered per second and average GL ms per frame (draw, readers, swap, motion), slowest draw. */
  previewStats?(ms: number): Promise<{ fps: number; cameraFps: number; drawMs: number; readersMs: number; swapMs: number; motionMs: number; maxDrawMs: number } | null>;
  /** Android, Quality Lab: thermal status 0 (none) … 6, or -1 if unknown. */
  thermalStatus?(): Promise<number>;
  /** Resolves when recording stops. */
  startRecording(): Promise<VideoResult>;
  stopRecording(): Promise<void>;
  /** Android: pause/resume the current recording (one file; paused time isn't recorded). */
  pauseRecording?(): Promise<boolean>;
  /** Android, Photo mode: hold-the-shutter burst; resolves after stopBurst() with the shots and the best one. */
  /**
   * `group`: the best shot with blinks fixed from other frames (2+ people, someone's eyes shut
   * in the pick, open in another frame; docs/design/switch-features.md §5). Absent when not needed.
   */
  /** `quick`: false keeps the bound capture instead of switching to the quick path (self-test comparison). */
  startBurst?(max: number, quick?: boolean): Promise<{
    frames: { uri: string; width: number; height: number }[];
    pick: number;
    group?: { uri: string; width: number; height: number; fixed: number };
    /** Whether the burst ran on the quick capture path; timing in ms from the burst start. */
    quick?: boolean;
    swapMs?: number;
    startsMs?: number[];
    savedMs?: number[];
  }>;
  stopBurst?(): Promise<void>;
  /** Android, while recording: a photo (full resolution where supported, else the video frame: `fromVideo`). */
  takeVideoPhoto?(): Promise<PhotoResult & { fromVideo?: boolean }>;
  /** Android, mode 'timelapse': resolves with the clip when stopTimeLapse() finishes it. */
  startTimeLapse?(): Promise<{ uri: string; duration: number; frames: number; hyperlapse?: boolean }>;
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
  /** Android (Play services): Google's document scanner; resolves the pages (empty if cancelled). Missing before the 9.4 APK. */
  scanDocument?(): Promise<{ uri: string; width: number; height: number }[]>;
  /** Android: the clip of a motion photo as its own MP4 (cached), or null if it has none. Missing before the 9.2 APK. */
  motionVideo?(uri: string): Promise<string | null>;
  /**
   * Plays a video with its look (colour part of the edit), live on the GPU:
   * the same shader as exportVideo, on expo-video's player. Android only;
   * missing in APKs before dev-43.
   */
  setVideoLook?(player: object, recipe: object | null): Promise<void>;
  /** Android self-test: what a saved photo contains. Missing before dev-67. */
  inspectPhoto?(uri: string): Promise<PhotoInfo>;
  /** Android self-test: a video's real frames, frame rate, length and sound. Missing before dev-67. */
  mediaInfo?(uri: string): Promise<MediaInfo>;
  /** Android self-test: the Play services ML Kit models; install = download missing ones (up to timeoutMs). Missing before dev-67. */
  mlModules?(install: boolean, timeoutMs: number): Promise<Record<string, unknown>>;
  /** Android, app start: Play services fetches missing ML Kit models in the background (returns at once). Missing before dev-68. */
  requestMlModules?(): Promise<void>;
};

export type PhotoInfo = { bytes: number; orientation: number; mirrored: boolean; gps: boolean; ultraHdr: boolean; motion: boolean; makerNote: boolean };
export type MediaInfo = {
  bytes: number;
  duration: number;
  frames: number;
  fps: number | null;
  width: number;
  height: number;
  rotation: number | null;
  codec: string | null;
  audio: boolean;
};

const imaging = Platform.OS === 'web' ? null : requireOptionalNativeModule<ImagingModule>('LensImaging');

/** True when on-device editing/looks are available (dev/production builds, not Expo Go). */
export const isImagingAvailable = imaging != null;

export const LensImaging = imaging;

/** People (docs/design/people.md): on-device face grouping, Android with Play services only. */
export type PeopleBenchmark = {
  ok: boolean;
  error?: string;
  initMs?: number;
  photos?: number;
  faces?: number;
  skipped?: number;
  detectMsPerPhoto?: number;
  embedMsPerFace?: number;
  results?: { faces: number; skipped: number; detectMs: number; embedMs: number; sharpness: number[]; eyeDistance: number[]; embeddings: number[][] }[];
};

export type PeopleGroup = { id: number; name: string | null; contactId: string | null; hidden: boolean; photos: number; coverFaceId: number };
/** waiting: on by default, the face model downloads at the next charge on Wi-Fi. */
export type PeopleStatus = { on: boolean; waiting?: boolean; ownPhotos: number; photos?: number; faces?: number; groups?: number };
export type PeoplePass = { scanned: number; faces: number; forgotten: number; merged: number; left: number; stoppedBy: string | null };

type PeopleModule = {
  available(): boolean;
  benchmark(modelPath: string, photos: string[]): Promise<PeopleBenchmark>;
  /** Self-test: real scanner + grouping in memory; groups = photo indexes per group. */
  groupTest(modelPath: string, photos: string[]): Promise<{ ok: boolean; error?: string; faces?: number; ms?: number; groups?: number[][] }>;
  status(): Promise<PeopleStatus>;
  /** Downloads the model (checked against sha256) and schedules the charging job. */
  enable(url: string, sha256: string): Promise<boolean>;
  ensureScheduled(): void;
  /** On by default: marks People on; the charging job downloads the model on Wi-Fi. */
  autoEnable(url: string, sha256: string): void;
  /** Two-letter country (SIM, network, language). */
  country(): string;
  /** Turns People off and deletes every bit of face data on the phone. */
  disable(): Promise<boolean>;
  scanNow(budgetSeconds: number): Promise<PeoplePass | null>;
  groups(minPhotos: number, includeHidden: boolean): Promise<PeopleGroup[]>;
  groupPhotos(groupId: number): Promise<{ photoId: string; faceId: number }[]>;
  asks(limit: number): Promise<{ faceId: number; groupId: number; photoId: string }[]>;
  faceThumb(faceId: number): Promise<string | null>;
  rename(groupId: number, name: string | null): Promise<void>;
  setContact(groupId: number, contactId: string | null): Promise<void>;
  hide(groupId: number, hidden: boolean): Promise<void>;
  merge(keep: number, other: number): Promise<void>;
  notSame(a: number, b: number): Promise<void>;
  notThis(faceId: number): Promise<number | null>;
  confirm(faceId: number, groupId: number): Promise<void>;
  reject(faceId: number, groupId: number): Promise<void>;
};

/** Null on iPhone, web and builds older than People. */
export const LensPeople = Platform.OS === 'android' ? requireOptionalNativeModule<PeopleModule>('LensPeople') : null;

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
