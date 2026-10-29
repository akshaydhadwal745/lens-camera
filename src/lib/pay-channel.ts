// Where Lens Plus can be bought with Razorpay: the website and the APK from our website. The Play
// Store build (EXPO_PUBLIC_STORE=play, play-bundle.yml) must use Google Play Billing instead, and
// iOS the App Store, so neither shows Razorpay (docs/business/payments.md).
import { Platform } from 'react-native';

export const razorpayHere = Platform.OS === 'web' || (Platform.OS === 'android' && process.env.EXPO_PUBLIC_STORE !== 'play');
/** The Play Store build: Google Play Billing (src/lib/play-billing.ts). */
export const playBillingHere = Platform.OS === 'android' && process.env.EXPO_PUBLIC_STORE === 'play';

export const rupees = (paise: number) => {
  const digits = paise % 100 ? 2 : 0;
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};
