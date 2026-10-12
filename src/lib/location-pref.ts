// "Save location" (Settings → Camera, and Places when it's empty): asks for the
// location permission at the moment it's turned on, never earlier.
import { PermissionsAndroid, Platform } from 'react-native';

import { loadSettings, setCameraOption } from './pro-camera';
import { notify } from './ui';

export function saveLocationOn(): boolean {
  return loadSettings().saveLocation;
}

/** Turns Save location on (after the permission) or off; resolves to the new state. */
export async function setSaveLocation(on: boolean): Promise<boolean> {
  if (on && Platform.OS === 'android') {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ]).catch(() => null);
    const granted =
      result?.[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === 'granted' ||
      result?.[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] === 'granted';
    if (!granted) {
      notify('Location is off', 'Lens needs location permission to save where you took photos. You can allow it in Android settings.');
      return false;
    }
  }
  setCameraOption('saveLocation', on);
  return on;
}
