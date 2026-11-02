// Landing spot for lens://plus-return (our Lens Plus payment page hands back here). The in-app
// browser session already returned to the Lens Plus screen, which checks the payment; this screen
// only keeps Expo Router from showing "not found" and steps back out of the way.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

export default function PlusReturn() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/plus');
  }, []);
  return <View style={{ flex: 1, backgroundColor: '#000' }} />;
}
