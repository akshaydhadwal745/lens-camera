// Crash reporting (Sentry, project instagrowapp/lens-app). Native crashes, JS errors and
// freezes reach the team with the build (dev-N) and phone model, so problems on users'
// phones are found and fixed. Private by default:
// - follows Settings → Camera → "Share camera diagnostics" (off = nothing is sent);
// - no IP address or user details, no screenshots or screen recordings;
// - URLs lose their query strings (signed photo links carry access tokens).
// Privacy policy: "Crash reports". Data safety: crash logs, optional.
import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';

import { buildInfo } from './build-info';
import { diagnosticsEnabled } from './diagnostics';

// Public by design (it only allows sending events to this project).
const DSN = 'https://b7eb5f51c1dea18d35a4dc39c11a2837@o4512292396072960.ingest.us.sentry.io/4512292413833216';

function stripQuery(url: unknown): unknown {
  return typeof url === 'string' ? url.replace(/[?#].*$/, '') : url;
}

let started = false;

export function startCrashReporting() {
  if (started || Platform.OS === 'web' || __DEV__) return;
  started = true;
  const info = buildInfo();
  Sentry.init({
    dsn: DSN,
    // Native crashes are sent on the next start by the native SDK, so the switch is read here too
    // (a change applies to them after a restart; JS events check it every time in beforeSend).
    enabled: diagnosticsEnabled(),
    release: info.code ? `lens@dev-${info.code}` : undefined,
    dist: info.apk ?? undefined,
    environment: 'production',
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0,
    enableAutoSessionTracking: true,
    beforeSend(event) {
      if (!diagnosticsEnabled()) return null;
      delete event.user;
      if (event.request) event.request.url = stripQuery(event.request.url) as string | undefined;
      return event;
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data && 'url' in crumb.data) crumb.data = { ...crumb.data, url: stripQuery(crumb.data.url) };
      if (crumb.category === 'console' && crumb.level !== 'error' && crumb.level !== 'warning') return null;
      return crumb;
    },
  });
  Sentry.setTag('apk', info.apk ?? 'unknown');
  Sentry.setTag('update', info.update ? 'ota' : 'embedded');
  if (info.runtime) Sentry.setTag('runtime', info.runtime);
}

export { Sentry };
