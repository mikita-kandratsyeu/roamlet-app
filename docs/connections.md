# Optional cloud connections

[Back to overview](../README.md)

## Connections

Sonner notifications stay above open dialogs regardless of notification type; dismissing a notification does not close the dialog.

Open **Menu → Connections** for a searchable, filterable grid of available services. Search and filter controls reuse the route library's sizing, inset search icon, focus treatment and selected-filter styling, including its mobile layout. Cards show connection status and a management action, with an accessible disconnect icon in the upper-right corner of connected cards; disconnection still requires confirmation. Connection checks live inside the relevant provider card, with a labeled refresh action, spinner, disabled pending state and stable keyboard focus rather than a detached page-wide Retry button. Setup and encrypted-backup operations open in a modal. First connection separates repository access, GitHub sign-in and repository selection into steps. Once configured, the modal shows a compact account/repository overview with an explicit Change repository action, plus keyboard-accessible Create a backup / Restore a backup tabs. Creation previews the current saved-route count, shows password validation beside the fields and keeps its upload action in the fixed footer; restoration uses a separate password and retains explicit conflict confirmation. Repository, cloud-backup and conflict choices use the same accessible dropdown component and styling as the planner, not native browser select menus. Empty cloud/repository lists provide next actions. Closing clears entered passwords, but an active operation first prompts Keep working / Stop and close; cancelling an upload does not guarantee that GitHub has not already saved it. No timestamps or route counts are inferred from UUID snapshot filenames; storage formats remain unchanged. Connector and OAuth errors use one dismissible Sonner notification rather than duplicate inline alerts on the page or in dialogs; connection-attention status remains on the card. Successful encrypted-backup uploads and library restorations also use a single dismissible Sonner notification, without inline success messages in the shared GitHub/Google Drive dialog. Local/manual planning, GPX, JSON backups and the route library remain independent of connections. There is no Roamlet account or application database.

### Google Drive

Google Drive appears **before GitHub** in the connector grid. Connect it with **Sign in with Google**; no repository, folder selection or API key is required. The shared encrypted-backup dialog provides Create a backup / Restore a backup tabs, password validation with an approximate strength indicator, a local cryptographically generated 24-character password (save it separately and confirm it before uploading), visibility controls for password fields, saved-route counts, planner-style dropdowns, explicit conflict confirmation and safe operation cancellation. Privacy and limits appear in a single collapsed section.

This connector uses Drive's **hidden application data folder (`appDataFolder`)**, not My Drive. Roamlet can access only its own app data, not the user's other files. Backups are created and restored through Roamlet; they do not appear as ordinary files in Drive. A separate application/client registration for development may have different app-data visibility from production: verify this before treating development copies as production backups. The route JSON and encryption container are unchanged and remain portable through the existing importer.

Google authorization uses `openid`, `email` and `https://www.googleapis.com/auth/drive.appdata`, PKCE S256 and a short-lived encrypted state cookie. The Google email identifies the connected account. Server functions exchange the authorization code and relay encrypted backups; no application database, plaintext backup storage or token logging is added. Tokens are stored only inside an encrypted, provider-specific HttpOnly/SameSite=Lax cookie (Secure over HTTPS). GitHub and Google sessions, selected targets, backup lists, errors and disconnect actions are independent.

**Access-only:** Google sessions last no longer than the access token, capped at one hour. Roamlet neither requests offline access nor stores/uses refresh tokens. Sign in again when access expires. Sessions survive reloads and are shared across tabs in this browser; focus/cross-tab changes recheck status without clearing a pending Google sign-in's short-lived state cookie. Disconnect clears only the Google session and attempts to revoke its current access token; it does not delete cloud copies or disconnect GitHub. Revocation is best-effort during provider/network failures, and stateless copied cookies cannot be centrally invalidated without a session store. Rotate the Google session key to invalidate Google cookies if required.

Encrypted transport is limited to **3 MiB** per backup, below Vercel Function request/response limits. Metadata discovery is paginated and bounded at 1000 snapshots, with validation of IDs, sizes, snapshot names and app-data ownership; repeated/duplicate or potentially incomplete results are rejected. Requests use fixed Google endpoints and a 20-second server operation deadline. Compressed Google responses are bounded by decoded body size; their wire Content-Length is not compared to the decoded byte count. There are no automatic retries, synchronization, cloud deletion or retention jobs. Concurrent writes can race storage preflight checks. Cancellation cannot guarantee that a submitted upload did not finish remotely. Local routes, manual planning and GPX remain available with no Google configuration or network.

#### Google Cloud setup

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com/), then enable **Google Drive API** under **APIs & Services → Library**.
2. Configure **Google Auth Platform** (or the OAuth consent screen): Branding/app name and support/developer contact emails, Audience **External** if users outside your Workspace need access. Add your application's homepage/privacy-policy URLs and verify authorized production domains where Google requires them.
3. Under **Data Access**, configure `openid`, `email` and `https://www.googleapis.com/auth/drive.appdata`. Do not request full Drive, `drive.readonly`, `drive.file`, profile or offline access for this connector. Google documents `drive.appdata` as [non-sensitive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth). Follow the console's current consent/publication requirements; non-sensitive scope does not guarantee that all branding or verification steps can be omitted.
4. Create an **OAuth client ID → Web application** under Clients/Credentials. Register the exact redirect URI `https://YOUR_DOMAIN/api/google-drive?action=callback`. Authorized JavaScript origins may include the app origin but do not replace the required redirect URI; the token exchange is server-side.
5. For development, prefer a separate OAuth client/project and redirect `http://127.0.0.1:5173/api/google-drive?action=callback`. Open the application on that exact origin. While Audience is **Testing**, add permitted Google accounts under Test users. Only listed test users can authorize an External testing application; testing authorizations may expire after seven days regardless of this connector's one-hour session.
6. Copy the OAuth Client ID and create/copy its client secret. Configure the following **server-only** variables in root `.env.local` for local development, or Vercel Environment Variables for production, following [.env.example](../.env.example):

| Variable                      | Value                                                 |
| ----------------------------- | ----------------------------------------------------- |
| `GOOGLE_DRIVE_CLIENT_ID`      | Web application OAuth client ID                       |
| `GOOGLE_DRIVE_CLIENT_SECRET`  | OAuth client secret                                   |
| `GOOGLE_DRIVE_CALLBACK_URL`   | Exact redirect URI registered above                   |
| `GOOGLE_DRIVE_SESSION_SECRET` | Canonical base64 of 32 cryptographically random bytes |

Generate a **separate** Google session key locally:

```sh
node --input-type=module -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('base64'))"
```

Never commit secrets, share them in chat, use `VITE_` prefixes or embed tokens in URLs. Mark client/session secrets **Sensitive** on Vercel. Restart Vite after local changes; redeploy Vercel after changing production variables. Missing configuration shows Google Drive as unavailable without blocking other connectors or local workflows. Apply Vercel Firewall limits to `/api/google-drive` before public access and verify real consent, callbacks, cookie flags, account switch, app-data isolation and backup/restore on the permanent HTTPS origin. Mocked tests do not validate live Google Cloud setup or approval/publication status.

### GitHub App

**Connect GitHub:**

1. Open GitHub connection settings and **Manage repository access**. Authorize the service's GitHub App to access only selected **private repositories**, with Contents read/write and Metadata read. Users do not create a GitHub App or enter a personal access token. Create an initial commit in the target repository. A dedicated repository is recommended: immutable snapshots accumulate in Git history.
2. Press **Sign in with GitHub**. Authorization returns to Connections; no personal access token is entered into Roamlet. Installation and authorization are separate: the user must have access to a repository included in an approved App installation.
3. **Load accessible repositories**, select a private repository and **Use this repository**. The bounded list includes only writable private repositories accessible to the installed App. Missing repositories may need updated installation access or organization approval.
4. Enter and confirm a password of at least 12 characters and **Create encrypted backup**. Each snapshot is a new UUID `.roamlet` file in `roamlet-backups` on the default branch. Only saved routes are included, not drafts, preferences, tokens or connection settings. Nothing is automatically uploaded or deleted.
5. **Refresh cloud backups**, select a snapshot, enter its original password and **Preview restoration**. Review route/conflict counts and choose copy (default), skip or replace, then explicitly confirm **Import routes**. The existing atomic transaction changes library entries only, never the current editor route or draft.

**Session and privacy:** OAuth uses PKCE S256 and a browser-bound, encrypted, short-lived state cookie. Server functions exchange the authorization code and hold the user access token only while processing requests. The encrypted AES-GCM session is stored in a HttpOnly/SameSite=Lax cookie, Secure on HTTPS, scoped to the app origin. JavaScript cannot read the token. No database, server-side session store or secret logging is added. Cookies share authorization across tabs and reloads in the same browser; session status is refreshed on opening Connections, returning focus and cross-tab change notifications. Only non-secret repository selection is persisted locally. Browser/device storage and cookies can still be cleared by the user or browser.

Sessions expire after at most **8 hours**. Expiring GitHub App user tokens are required; refresh tokens are discarded and not persisted. Sign in again after expiry or revocation. Disconnect clears this browser's session and attempts to revoke its GitHub user access token. It does not delete routes or cloud files. Revocation is best-effort during provider/network failures; a copied valid stateless session cookie cannot be centrally invalidated without a session store. Rotate the session encryption key to invalidate all app cookies if needed. Browser extensions, malicious scripts, or a compromised deployment can still abuse an unlocked session; HttpOnly is not a complete XSS defense.

This explicitly replaces browser-direct token transport: the browser calls same-origin `/api/github` Vercel functions, which forward requests to fixed GitHub endpoints. **Roamlet server functions see GitHub tokens and encrypted backup bytes while handling requests**, but do not decrypt backups, receive backup passwords, or store tokens/backups in a database. GitHub sees repository/file metadata. Client encryption continues to use the existing versioned route backup inside a versioned binary PBKDF2-SHA-256/AES-256-GCM container with fresh salt/IV. Roamlet cannot recover a lost password. Keep it separately and retain a local backup.

**Limits:** encrypted GitHub uploads/downloads are limited to **3 MiB** to stay below Vercel Function request/response limits. Local JSON backups retain their independent 20 MiB and existing route/point limits. Oversize ciphertext is rejected before transmission. GitHub requests and response streams are bounded, with a 20-second total server operation deadline; there are no automatic retries. At most 100 accessible installation/repository results are enumerated; potentially truncated lists fail rather than silently appear complete. Keep `roamlet-backups` below 1000 total entries: upload refuses 999 or more, and listing refuses 1000 or more. Concurrent clients or external writes can race the directory preflight. This is manual backup/restore, not multi-device synchronization. Cancelled uploads may already have committed: refresh before retrying. Atomic local import cannot be cancelled once started.

### Deployment setup

Create a **GitHub App**, not an OAuth App, under GitHub developer settings:

- Set its homepage to the permanent application origin.
- Set **Callback URL** to `https://YOUR_DOMAIN/api/github?action=callback`, matching `GITHUB_APP_CALLBACK_URL` exactly. Use a separate App for development with `http://127.0.0.1:5173/api/github?action=callback`; local HTTP cookies are allowed only on loopback.
- Grant repository **Contents: read and write**, **Metadata: read**. No account permissions, webhooks or private key are required for this user-to-server OAuth flow. Disable webhooks if unused.
- Enable expiring user authorization tokens. Keep **Request user authorization (OAuth) during installation** disabled: install for selected repositories first, then use Roamlet's sign-in flow to generate browser-bound state and PKCE.
- Copy its OAuth **Client ID**, create a **Client secret**, and note the App URL slug. The client secret is not an installation token or private key.

Configure these **server-only** variables in Vercel Settings → Environment Variables, using Sensitive values for secrets, then redeploy:

| Variable                   | Value                                                |
| -------------------------- | ---------------------------------------------------- |
| `GITHUB_APP_CLIENT_ID`     | GitHub App OAuth Client ID                           |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App OAuth client secret                       |
| `GITHUB_APP_SLUG`          | Slug from `https://github.com/apps/SLUG`             |
| `GITHUB_APP_CALLBACK_URL`  | Exact callback URL above                             |
| `GITHUB_SESSION_SECRET`    | Base64 encoding of 32 cryptographically random bytes |

Generate the session encryption key locally with Node.js and paste it directly into Vercel's Sensitive environment field (never commit it, put it in a URL, use a `VITE_` prefix or share it in chat):

```sh
node --input-type=module -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('base64'))"
```

For local development, use root `.env.local` following [.env.example](../.env.example), then restart Vite. The shared local middleware serves the same GitHub handlers as Vercel. Missing configuration returns an unavailable connection status without blocking local workflows. Existing ORS settings remain separate. Apply Vercel Firewall limits to `/api/github` before public use; this stateless implementation does not enforce an account-wide quota. Verify real App installation, OAuth callback, cookie flags, repository permissions and backup round-trip on the permanent HTTPS domain. Mocked tests do not validate live GitHub/Vercel configuration.

The OAuth callback accepts an optional `iss` parameter only when it exactly equals `https://github.com/login/oauth`; invalid issuers, duplicate parameters and unknown parameters are rejected. Callbacks without `iss` retain state/PKCE validation.

**Extension points:** [registry.ts](../client/src/services/connectors/registry.ts) owns service-card metadata and adapter construction; [types.ts](../client/src/services/connectors/types.ts) defines provider-independent backup operations. [githubSession.ts](../client/src/services/connectors/githubSession.ts) and [useGitHubSession](../client/src/hooks/useGitHubSession.ts) own GitHub-specific session transport/lifecycle; [github.ts](../client/src/services/connectors/github.ts) implements storage operations. [useStorageConnector](../client/src/hooks/useStorageConnector.ts) orchestrates encrypted backup/restore. [StorageConnections](../client/src/components/StorageConnections.tsx) renders the catalog and [GitHubConnectionDialog](../client/src/components/GitHubConnectionDialog.tsx) renders GitHub setup/operations. Add provider metadata, an adapter, its authentication/settings modal and contract tests without changing encryption/import. AI providers should have a separate capability contract, not implement the storage interface. No arbitrary third-party plugin execution is introduced.

Google implementation uses [googleDrive.ts](../client/src/services/connectors/googleDrive.ts), [googleDriveSession.ts](../client/src/services/connectors/googleDriveSession.ts) and [useGoogleDriveSession](../client/src/hooks/useGoogleDriveSession.ts). Both provider-specific settings dialogs compose [StorageBackupDialog](../client/src/components/StorageBackupDialog.tsx); bounded same-origin transport is shared in [http.ts](../client/src/services/connectors/http.ts). Provider-specific authentication remains separate from backup operations, and the registry order controls the service-card order.
