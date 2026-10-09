import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';

import { isProCameraAvailable } from '../../modules/lens-camera';
import { BasicCamera } from '@/components/BasicCamera';
import { ProCamera } from '@/components/pro/ProCamera';
import { notify } from '@/lib/ui';

export default function Index() {
  // The pro camera couldn't start on this phone: use the basic camera this session.
  const [fallback, setFallback] = useState(false);
  // The web app is a viewer only: no camera.
  if (Platform.OS === 'web') return <Redirect href="/gallery" />;
  // Development/production builds include the native pro camera; Expo Go doesn't.
  if (!isProCameraAvailable || fallback) return <BasicCamera />;
  return (
    <ProCamera
      onUnavailable={(message) => {
        setFallback(true);
        notify('Switched to the basic camera', message);
      }}
    />
  );
}
