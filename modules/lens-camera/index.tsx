import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { ComponentType, forwardRef, Ref } from 'react';
import { NativeSyntheticEvent, Platform, ViewProps } from 'react-native';

export type Lens = 'ultraWide' | 'wide' | 'telephoto';
export type CameraMode = 'photo' | 'video' | 'night' | 'portrait';
export type Stabilization = 'off' | 'standard' | 'cinematic' | 'extended';

export type Capabilities = {
  position: 'front' | 'back';
  lens: Lens;
  mode: CameraMode;
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
  torch: boolean;
  /** Modes this camera supports (Android reports it; iOS supports all). */
  modes?: CameraMode[];
  /** Android: what the hardware allows. pro = manual sensor + white balance, basic = auto only. */
  tier?: 'pro' | 'standard' | 'basic';
  /** Android 14+: Ultra HDR photos (JPEG with an HDR gain map). */
  ultraHdr?: boolean;
};

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
  analysis: AnalysisSettings;
  onReady?: (e: NativeSyntheticEvent<Capabilities>) => void;
  onStats?: (e: NativeSyntheticEvent<CameraStats>) => void;
  onAnalysis?: (e: NativeSyntheticEvent<AnalysisResult>) => void;
  /** `fatal`: the camera couldn't start at all (the app falls back to the basic camera). */
  onError?: (e: NativeSyntheticEvent<{ message: string; fatal?: boolean }>) => void;
};

export type PhotoResult = { uri: string; width: number; height: number; raw: boolean; depth?: boolean; frames?: number };
export type VideoResult = { uri: string; duration: number };

export type LensCameraHandle = {
  takePhoto(options: { raw: boolean; flash: 'off' | 'on' | 'auto' }): Promise<PhotoResult>;
  /** Night mode: burst of `frames`, aligned and merged on the device. */
  takeNightPhoto(frames: number): Promise<PhotoResult>;
  /** Resolves when recording stops. */
  startRecording(): Promise<VideoResult>;
  stopRecording(): Promise<void>;
  focusAt(x: number, y: number): Promise<void>;
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
