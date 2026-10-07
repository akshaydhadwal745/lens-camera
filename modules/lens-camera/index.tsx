import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { ComponentType, forwardRef, Ref } from 'react';
import { NativeSyntheticEvent, Platform, ViewProps } from 'react-native';

export type Lens = 'ultraWide' | 'wide' | 'telephoto';

export type Capabilities = {
  position: 'front' | 'back';
  lens: Lens;
  mode: 'photo' | 'video';
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
  flash: boolean;
  torch: boolean;
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
  position: 'front' | 'back';
  lens: Lens;
  mode: 'photo' | 'video';
  videoResolution: '1080p' | '4k';
  appleLog: boolean;
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
  analysis: AnalysisSettings;
  onReady?: (e: NativeSyntheticEvent<Capabilities>) => void;
  onStats?: (e: NativeSyntheticEvent<CameraStats>) => void;
  onAnalysis?: (e: NativeSyntheticEvent<AnalysisResult>) => void;
  onError?: (e: NativeSyntheticEvent<{ message: string }>) => void;
};

export type PhotoResult = { uri: string; width: number; height: number; raw: boolean };
export type VideoResult = { uri: string; duration: number };

export type LensCameraHandle = {
  takePhoto(options: { raw: boolean; flash: 'off' | 'on' | 'auto' }): Promise<PhotoResult>;
  /** Resolves when recording stops. */
  startRecording(): Promise<VideoResult>;
  stopRecording(): Promise<void>;
  focusAt(x: number, y: number): Promise<void>;
};

/** True in development/production builds that include the native module (not Expo Go / web). */
export const isProCameraAvailable =
  Platform.OS === 'ios' && requireOptionalNativeModule('LensCamera') != null;

const NativeView: ComponentType<LensCameraProps & { ref?: Ref<LensCameraHandle> }> | null = isProCameraAvailable
  ? requireNativeView('LensCamera')
  : null;

export const LensCameraView = forwardRef<LensCameraHandle, LensCameraProps>(function LensCameraView(props, ref) {
  if (!NativeView) return null;
  return <NativeView {...props} ref={ref} />;
});
