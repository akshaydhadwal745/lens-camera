// Sharing: requests to you + what you sent (src/components/SharesList.tsx).
import { useLocalSearchParams } from 'expo-router';

import { SharesList } from '@/components/SharesList';

export default function SharesScreen() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  return <SharesList initial={tab === 'sent' ? 'out' : 'in'} />;
}
