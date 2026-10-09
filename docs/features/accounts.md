# Accounts and sign-in (phone apps)

**Promise:** you never lose your photos. Lens works right away as a guest;
signing in ties everything to an account you can get back on any phone, or
after reinstalling.

**Code:** app `src/app/signin.tsx`, `src/lib/store.ts` (`sendSignInCode`,
`signInWithCode`, `signInWithGoogle`, `logOut`), `src/lib/identity.ts`;
server `infra/lambda/api/auth.ts`, `identity.ts` (sessions), `oauth.ts`
(`googleLoginClaims`). Web sign-in is out of scope for now.

## Signing in

| Method | Where | How |
|---|---|---|
| Email + 6-digit code | iPhone and Android | Type your email → code arrives by email → type it (auto-submits at 6 digits) |
| Continue with Google | Android | One tap through Google's sign-in page (uses the same Google project as Drive) |

iPhone shows email only, so Apple's rule that apps offering Google sign-in
must also offer Sign in with Apple doesn't apply.

**Codes:** 6 digits, valid 10 minutes, single use, 5 wrong tries lock the
code, at most 5 codes per hour per email. Sent from `no-reply@<our domain>`
via Amazon SES.

## What happens when you sign in

| Situation | Result |
|---|---|
| First time with this email | This phone's guest identity **becomes** your account. Nothing moves. |
| Email already has an account (new phone, reinstall) | This phone joins that account. Any photos the phone took as a guest are **moved into the account** (records only; files stay where they are, so it's fast), with their shares and quota. The guest identity is removed. |
| Google account whose verified email already has an account | Same account as the email sign-in. |

Very large guest libraries move in rounds; the app continues automatically.

## Sessions

- One session per device, stored hashed on the server and checked on every
  request, so logging out takes effect immediately.
- Stays signed in while used; ends after **90 days without use** (sliding).
- **Settings → Account:** your email, the list of devices (this phone
  marked), **Log out other devices**, **Log out**.
- **Log out** only when everything is uploaded; local copies are then removed
  (they're safe in your account) and the phone starts a fresh guest.
- **Signed out from elsewhere / expired:** uploads pause and the gallery shows
  "You were signed out — tap to sign in" (the phone does **not** become a new
  guest, which would split your photos). This survives app restarts.

## Gentle nudge

Guests with 3+ photos see a dismissible gallery banner: "Sign in so you never
lose your photos". Settings → Account has the same prompt.

## Setup (owner)

- `cdk.json` context `codeDomain` = your domain. Deploy prints three
  `CodeDomainDkim…` outputs: add them as CNAME records in the domain's DNS.
  SES verifies the domain within minutes to hours.
- SES in **ap-south-1** (the API's region) already has **production access**
  on this account (67,200 emails/day), so codes reach any address.
- Google sign-in uses the Google client registered for Drive; while the
  consent screen is in Testing, only listed test users can use it.
