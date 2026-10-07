import { Redirect } from 'expo-router';
import { Platform } from 'react-native';

import { isProCameraAvailable } from '../../modules/lens-camera';
import { BasicCamera } from '@/components/BasicCamera';
import { ProCamera } from '@/components/pro/ProCamera';

export default function Index() {
  // The web app is a viewer only: no camera.
  if (Platform.OS === 'web') return <Redirect href="/gallery" />;
  // Development/production builds include the native pro camera; Expo Go doesn't.
  return isProCameraAvailable ? <ProCamera /> : <BasicCamera />;
}
