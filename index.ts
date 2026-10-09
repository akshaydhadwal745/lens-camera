// App entry: background tasks must be defined before the app (and also when
// the OS starts Lens headless to run them), then hand over to Expo Router.
import './src/lib/background';
import 'expo-router/entry';
