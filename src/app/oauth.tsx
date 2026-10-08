// Landing spot for lens://oauth (storage sign-in redirect). The in-app browser
// session already delivered the result to connectStorage(); this screen only
// keeps Expo Router from showing "not found" and steps back out of the way.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

export default function OAuthReturn() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/storage');
  }, []);
  return <View style={{ flex: 1, backgroundColor: '#000' }} />;
}
