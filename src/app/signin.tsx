import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/lib/api';
import { ConnectCancelled } from '@/lib/storage';
import { sendSignInCode, signInWithCode, signInWithGoogle, useStore } from '@/lib/store';
import { colors, errorMessage, notify } from '@/lib/ui';

const RESEND_SECONDS = 30;

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const signedOut = useStore((s) => s.signedOut);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [googleReady, setGoogleReady] = useState(false);
  const codeInput = useRef<TextInput>(null);

  // One-tap Google on Android (iPhone uses email, so no Apple sign-in is required).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    api
      .oauthProviders()
      .then((r) => setGoogleReady(!!(r.providers as Record<string, boolean>).google))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const done = () => {
    notify('Signed in', 'Your photos are tied to your account now. Sign in on any phone to get them back.');
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const send = async () => {
    if (busy || !email.trim()) return;
    setBusy('send');
    setError(null);
    try {
      await sendSignInCode(email.trim());
      setStep('code');
      setCode('');
      setResendIn(RESEND_SECONDS);
      setTimeout(() => codeInput.current?.focus(), 300);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value = code) => {
    if (busy || value.length !== 6) return;
    setBusy('verify');
    setError(null);
    try {
      await signInWithCode(email.trim(), value);
      done();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    if (busy) return;
    setBusy('google');
    setError(null);
    try {
      await signInWithGoogle();
      done();
    } catch (e) {
      if (!(e instanceof ConnectCancelled)) setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView style={[styles.fill, { paddingTop: insets.top || 12 }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable onPress={() => (step === 'code' ? setStep('email') : router.back())} hitSlop={10} style={styles.headerButton}>
          <Text style={styles.done}>{step === 'code' ? 'Back' : 'Cancel'}</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <Ionicons name="shield-checkmark-outline" size={48} color={colors.link} />
        <Text style={styles.title}>{signedOut ? 'Sign in again' : 'Keep your photos safe'}</Text>
        <Text style={styles.subtitle}>
          {signedOut
            ? 'You were signed out. Sign in to continue uploading. Nothing on this phone is lost.'
            : 'Sign in so you can get your photos back on a new phone or after reinstalling Lens.'}
        </Text>

        {step === 'email' ? (
          <>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#636366"
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={send}
              editable={!busy}
            />
            <Pressable style={[styles.button, !email.trim() && styles.disabled]} onPress={send} disabled={!email.trim() || !!busy}>
              {busy === 'send' ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Email me a code</Text>}
            </Pressable>

            {googleReady && (
              <>
                <View style={styles.orRow}>
                  <View style={styles.orLine} />
                  <Text style={styles.orText}>or</Text>
                  <View style={styles.orLine} />
                </View>
                <Pressable style={styles.googleButton} onPress={google} disabled={!!busy}>
                  {busy === 'google' ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Ionicons name="logo-google" size={18} color="#000" />
                      <Text style={styles.googleText}>Continue with Google</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </>
        ) : (
          <>
            <Text style={styles.sentTo}>
              We sent a 6-digit code to <Text style={{ color: '#fff', fontWeight: '700' }}>{email.trim()}</Text>
            </Text>
            <TextInput
              ref={codeInput}
              value={code}
              onChangeText={(v) => {
                const digits = v.replace(/\D/g, '').slice(0, 6);
                setCode(digits);
                if (digits.length === 6) void verify(digits);
              }}
              placeholder="123456"
              placeholderTextColor="#636366"
              style={[styles.input, styles.codeInput]}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              editable={!busy}
            />
            <Pressable style={[styles.button, code.length !== 6 && styles.disabled]} onPress={() => verify()} disabled={code.length !== 6 || !!busy}>
              {busy === 'verify' ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
            </Pressable>
            <Pressable onPress={send} disabled={resendIn > 0 || !!busy} style={styles.linkButton}>
              <Text style={[styles.link, resendIn > 0 && { color: '#636366' }]}>
                {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
              </Text>
            </Pressable>
            <Text style={styles.hint}>Can’t find it? Check your spam folder.</Text>
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { height: 52, paddingHorizontal: 16, justifyContent: 'center' },
  headerButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  done: { color: colors.link, fontSize: 17, fontWeight: '600' },
  body: { paddingHorizontal: 24, paddingTop: 24, gap: 14, maxWidth: 480, width: '100%', alignSelf: 'center', alignItems: 'stretch' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 21, marginBottom: 8 },
  input: { backgroundColor: '#1C1C1E', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#fff', fontSize: 17 },
  codeInput: { fontSize: 28, letterSpacing: 10, textAlign: 'center', fontVariant: ['tabular-nums'] },
  button: { backgroundColor: colors.action, borderRadius: 980, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  googleButton: {
    backgroundColor: '#fff',
    borderRadius: 980,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  googleText: { color: '#000', fontSize: 16, fontWeight: '600' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#2C2C2E' },
  orText: { color: '#86868B', fontSize: 13 },
  sentTo: { color: colors.muted, fontSize: 15 },
  linkButton: { alignSelf: 'center', padding: 8 },
  link: { color: colors.link, fontSize: 15, fontWeight: '600' },
  hint: { color: '#636366', fontSize: 13, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
});
