# Security architecture

Passwords use Argon2id (64 MiB, three iterations, one lane). Random 256-bit opaque session tokens are stored as SHA-256 hashes. Cookies are HttpOnly, SameSite=Lax, path /, Secure in production, with the __Host- prefix. Sessions expire after 30 days or seven idle days. No browser refresh token exists. Devices, remote revocation, logout-all and password changes operate server-side.

Mutations verify the exact Origin and session-bound CSRF. WebSockets validate upgrade, first frame, subsequent frames and ongoing permissions. Login failures are generic with a dummy-hash missing-user path. PostgreSQL rate buckets cover identity, messaging, mentions, reactions, invites, uploads, search, webhooks and realtime activity across replicas.

Strict Zod schemas reject mass assignment; SQL values are parameterized. Bodies, files, provider responses and realtime buffers are bounded. Errors omit stacks and infrastructure details. Structured application/security logs omit bodies, query values, cookies and credentials; audit records are separate.

## Authorization

Authentication alone grants no object access. Domain operations check ownership/membership, effective permissions and relationships. Rank prevents nonowner escalation. Channel overrides, replies, attachments, search, DMs and group membership retain their own checks.

RLS complements API checks. The API role is non-superuser, does not bypass RLS or own tables, and cannot read credential columns. Auth, worker and migrator have separate grants. Definer functions fix search_path. Runtime processes and database administrators remain trust boundaries. [PostgreSQL RLS documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) explains owner/superuser bypass.

## Files and providers

Files are limited to 8 MiB, text to 1 MiB. Extension, MIME and signature must agree. PNG/JPEG/WebP/GIF decode with pixel/frame limits and re-encode without metadata. Text/Markdown/CSV require valid UTF-8 and reject binary controls. SVG, archives, executables and unsupported formats are rejected. UUID storage keys never derive from filenames. Downloads recheck access and use restrictive headers. Unattached files older than one day enter retryable cleanup.

OAuth uses fixed hosts, bounded requests/responses, short-lived one-use cookie-bound state, and PKCE where supported. Existing password accounts are never silently linked by email. AES-256-GCM encrypts provider/webhook secrets with associated context. The authorized webhook creator sees a new signing secret once; normal DTOs expose no tokens.

Incoming webhooks require X-Noctis-Timestamp (Unix seconds), X-Noctis-Delivery (unique ID), X-Noctis-Signature (hex HMAC-SHA256). Sign the exact string `timestamp.deliveryId.rawRequestBody`. Age must be within five minutes; repeated IDs are rejected. Receipt and execution recheck webhook state and permissions. Consult route schemas for accepted ID and body formats.

## Audit and operations

Security operations append actor/action/target/time and bounded metadata. Advisory locking orders a SHA-256 chain. Runtime roles cannot mutate audit rows; a trigger rejects update/delete/truncate. This does not prevent a database owner replacing triggers and recomputing history. Export checkpoints/logs independently. `npm run audit:verify` validates continuity and hashes through an operator connection.

Production requires HTTPS and verified database TLS. PostgreSQL rejects plaintext TCP. Only the configured Caddy address is trusted for forwarded client IPs. API/worker containers run nonroot with read-only roots, dropped capabilities and a persistent external upload volume. Protect environment secrets and encrypt backups; never commit .env files.

The automated tests establish specific controls, not universal security or an independent penetration test. Provider consent and public WebRTC connectivity across restrictive networks need external credentials and deployment validation. WebRTC media is encrypted in transit to the SFU; this implementation does not claim end-to-end media encryption.

## Account security

Email ownership is required by both API authorization and PostgreSQL session policies. Registration issues a restricted session that can only reach account authentication endpoints until confirmation. Existing password accounts must verify their email too; they are never automatically trusted by the migration. A successful Google/GitHub callback verifies only the exact email proven by the provider.

Verification links expire in 60 minutes; password reset links expire in 20 minutes. Random 256-bit tokens are stored as SHA-256 hashes, scoped to the account and purpose, consumed atomically, and replaced when reissued. Email links carry tokens in URL fragments, which do not reach HTTP logs; the browser removes the fragment token on opening the form. Refreshing that page requires reopening the email link. Forgot-password responses are generic with asynchronous delivery, an ordinary 300 ms response floor and limits per IP/account. Reset requires MFA if enabled, revokes every session and pending login challenge, notifies the mailbox, and does not sign the user in automatically.

Optional TOTP uses RFC 6238 (SHA-1, 6 digits, 30 seconds, ±1 step). Encrypted seeds use AES-256-GCM with user-specific associated data; accepted counters advance atomically to prevent replay. Setup expires after 10 minutes and requires a valid code before enabling MFA. Ten random 128-bit recovery codes are shown once and stored only as context-bound hashes. Each works once. Replacing codes invalidates the previous set. Setup, removal and replacement require the current password, or a provider session created within the past 5 minutes for accounts without a password; removal/replacement additionally requires an existing factor. Sensitive mutations serialize under the user row lock and revoke other sessions.

Password and Google/GitHub login both pass through the same MFA gate. The first step produces only a five-minute, HttpOnly, cookie-bound challenge when MFA is enabled. No full session is issued until a valid second factor is consumed. Password or MFA changes invalidate pending challenges. Sessions also carry MFA assurance checked against the current enrollment in both application code and PostgreSQL. Password changes require a second factor for enrolled accounts. Losing both the authenticator and all recovery codes cannot be resolved by email-only recovery; no bypass endpoint exists.

Signing out everywhere advances the account's authentication version and removes pending MFA challenges in the same transaction that revokes all active sessions. Session creation and revocation serialize on the user row. Password proofs capture the version before Argon2 verification; provider proofs capture it when the verified identity is mapped to an account. Both challenge issuance and final session creation reject a retired version, including when revocation commits between those steps. Session-management mutations recheck the requesting session after obtaining the lock. Signing out of one session preserves other devices and removes only that browser's pending MFA challenge for the same account. Logout clears session and MFA cookies. A fresh login with valid credentials remains possible after revocation.

MailerSend delivery uses authenticated SMTP on port 587 with required STARTTLS and verified certificates. Outbox payloads are encrypted and delivered by the worker, with bounded retries and a stable message ID. Delivered payloads are removed; stale outbox payloads are removed after one day. Delivery is at least once across an SMTP acceptance/process crash boundary, so a duplicate email remains possible. Monitor queue age and failed attempts. Development/test file delivery writes private messages under `STORAGE_PATH/mail` and is rejected in production. Do not log or commit mailbox files, MFA secrets or recovery codes.

`npm run security:preflight` checks the configured production environment without changing it. `npm run test:restore` rehearses an encrypted backup and restore of the local test database, uploads, and encryption key in an isolated database; it does not establish production backup coverage. Keep production backups and key custody separate from the application host, and perform a real production restoration drill.

Design references: [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html), [OWASP password recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [MailerSend SMTP](https://developers.mailersend.com/api/v1/email/smtp-relay).

References: [OWASP WebSockets](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html), [sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Music sources

Music permissions are separate for play, pause, skip, stop, volume, queue management and moving the bot. Every command rechecks membership and effective server permissions; dynamic server settings may allow member skip or volume changes without granting broader role rights. Queue and session mutations serialize under a server-scoped database lock, and realtime music events remain scoped to current server members.

Playable URLs must use HTTPS and match an exact host in `MUSIC_AUDIO_HOSTS`. Validation rejects credentials, IP literals and non-HTTPS schemes, resolves every DNS answer and blocks loopback, link-local, private, multicast and metadata-network destinations. Every redirect is revalidated, DNS is pinned for the request, response time and size are bounded, and audio content type is required. FFmpeg is spawned directly with an argument array and receives no shell-interpreted input. Application logs redact source URLs and provider payloads.

YouTube, Spotify and SoundCloud playback stays inside their official embedded players. Noctis stores the validated public provider URL and synchronized session state; it receives no media URL, decrypted payload or provider credential. Content Security Policy permits scripts and frames only from the exact official player origins. Provider autoplay, account, geography and catalog decisions remain enforced inside the embedded player. Direct-host allowlisting grants server-side access to media served by that host, so operators must list only origins they control or explicitly trust.
