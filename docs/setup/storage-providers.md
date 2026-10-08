# Setting up storage providers (one time, by the Lens owner)

Users connect Google Drive, Dropbox, OneDrive and Box by signing in. For that,
Lens must be registered once with each provider as a **web application**. All
registrations are free. S3-compatible and WebDAV need no setup.

Every provider gets the **same redirect URI**: the Lens API's callback. Print
it with:

```bash
cd infra && node -p "require('./outputs.json').Lens.ApiUrl.replace(/\/$/, '') + '/v1/oauth/callback'"
```

After registering, save the client ID + secret (stored encrypted in AWS SSM;
no deploy needed; a changed secret takes effect when the API next restarts):

```bash
cd infra && scripts/set-oauth-client.sh <gdrive|dropbox|onedrive|box> '<client id>' '<client secret>'
```

The **Connect** button for that provider then appears in the app (Settings →
Storage). Until then it shows "Soon".

## Google Drive

1. <https://console.cloud.google.com> → create a project "Lens".
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, app name "Lens", your support email.
   - **Data access / Scopes** → add `.../auth/drive.file` (and `openid`,
     `email`). `drive.file` only lets Lens see files Lens created, so no
     Google security assessment is needed.
   - **Audience** → stay in **Testing** and add the Google accounts that
     will test (up to 100). Going public later needs a privacy policy URL and a
     domain you own.
4. **Clients → Create client → Web application**, name "Lens API".
   - **Authorized redirect URIs:** the callback URI above.
5. Copy the client ID + secret → `scripts/set-oauth-client.sh gdrive …`.

## Dropbox

1. <https://www.dropbox.com/developers/apps> → **Create app**.
2. **Scoped access** → **App folder** → name "Lens" (files go to /Apps/Lens).
3. **Permissions** tab → tick `account_info.read`, `files.metadata.read`,
   `files.content.write`, `files.content.read` → **Submit**.
4. **Settings** tab → **Redirect URIs** → add the callback URI.
5. App key = client ID, App secret = client secret → `scripts/set-oauth-client.sh dropbox …`.
6. In development mode up to 50 users can connect; apply for production later.

## OneDrive (Microsoft)

1. <https://entra.microsoft.com> → **App registrations → New registration**.
2. Name "Lens"; **Supported account types:** "Accounts in any organizational
   directory and personal Microsoft accounts".
3. **Redirect URI:** platform **Web**, the callback URI.
4. **Certificates & secrets → New client secret** → copy the **Value**
   (shown once). Note its expiry (max 24 months) and renew before then.
5. **API permissions → Add → Microsoft Graph → Delegated:**
   `Files.ReadWrite.AppFolder`, `User.Read`, `offline_access`.
6. Application (client) ID + secret value → `scripts/set-oauth-client.sh onedrive …`.

## Box

1. <https://app.box.com/developers/console> → **Create Platform App** →
   **User Authentication (OAuth 2.0)**, name "Lens".
2. **Configuration** → **OAuth 2.0 Redirect URI:** the callback URI.
3. **Application Scopes:** "Read all files and folders" + "Write all files
   and folders" → Save.
4. Client ID + Client Secret → `scripts/set-oauth-client.sh box …`.

## Testing on Android

Storage sign-in doesn't work in Expo Go. Install the Lens APK from the latest
`dev-N` release (built automatically when native dependencies change), open
Settings → Storage → Connect. See [development.md](../development.md).
