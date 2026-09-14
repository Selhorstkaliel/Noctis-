# Deployment and operations

## MailerSend and account-security rollout

Configure and verify your sending domain in MailerSend, including its required DNS records. Create SMTP credentials for that domain; these are different from an API token. Set the following in the production secret store/environment (see `.env.production.example`):

```dotenv
MAIL_TRANSPORT=smtp
MAIL_FROM=security@your-verified-domain.com
SMTP_HOST=smtp.mailersend.net
SMTP_PORT=587
SMTP_USER=your-mailersend-smtp-username
SMTP_PASSWORD=your-mailersend-smtp-password
```

The app requires STARTTLS on port 587 with certificate validation, following [MailerSend's SMTP documentation](https://developers.mailersend.com/api/v1/email/smtp-relay). Keep the worker running: the API queues encrypted messages and the worker delivers them. SMTP credentials and domain verification must be ready before exposing the updated app. Validate a real registration, inbox delivery, reset, and MFA sign-in against the deployed domain. No production email is sent by the local automated suites.

Back up the database, uploads and ENCRYPTION_KEY before applying migration `015_account_security.sql` with the normal migration command. The migration does not mark existing password accounts as verified: on their next login/access they must confirm ownership. A previously verified Google/GitHub identity can verify its exact matching account email on callback. Do not bulk mark user emails verified to avoid delivery setup. Existing authenticated clients encountering the gate should sign in again. Configure SMTP first to avoid locking users out of community access.

MFA seeds and the mail outbox now also depend on ENCRYPTION_KEY; key rotation must re-encrypt `account_mfa.secret_encrypted` with `mfa:<user_id>` associated data and `security_mail.payload_encrypted` with `mail:<id>`, as well as existing provider/webhook credentials. Keep database clocks synchronized for authenticator codes. Do not disable MFA merely because a requester controls an email address.

Run `npm run security:preflight` with the actual production environment from an operator checkout that has dependencies installed. It verifies runtime roles, active database TLS, restricted secret tables, identity-free denial and public HTTPS headers. This is a read-only deployment check, not a penetration test. Configure monitoring for outbox backlog (`security_mail.available_at`, `attempts`, `created_at`), delivery failures, authentication failures and HTTP 429/5xx. Retry is bounded to eight attempts; payloads older than one day are purged.

The session-revocation update uses the existing `auth_version` column and requires no new migration beyond 016. Update every API replica before relying on the stronger logout-all behavior; an older replica does not fence password proofs against logout-all. For the local Docker stack, run `npm.cmd run docker:up` on Windows (or `npm run docker:up`) to rebuild and recreate the application containers while preserving data.

Run `npm run test:restore` after the test suites finish, with Docker and `noctis_test` available. It takes a bounded encrypted snapshot of the isolated test database and uploads, includes the encryption key, restores into a fresh `noctis_restore_test_<random>` database, checks counts/file hashes/audit continuity/RLS/MFA decryption, then removes only its temporary resources. Its JSON report is `.runtime/restore-report.json`. Do not run it concurrently with tests that mutate fixtures. It does not create a retained production backup; establish off-host backup retention, protected key custody and a production restoration drill separately.

## Development and tests

Follow README for local startup. PostgreSQL's development port binds only to loopback. Development HTTP and DATABASE_SSL=false are deliberate local exceptions; production startup rejects either.

Run `npm run test:setup` after schema changes. It creates a separate noctis_test database with the restricted roles, preserves private test secrets, migrates and seeds it. Browser fixtures may clear rate buckets only after verifying the database name ends in _test. Application abuse controls remain enabled.

## Production configuration

1. Copy .env.production.example to a private deployment environment file. Generate independent random role passwords, SESSION_SECRET and ENCRYPTION_KEY (32 random bytes as 64 hex characters). Keep URL passwords correctly percent-encoded. Do not use demo credentials or expose environment files to the browser.
2. Set a real PUBLIC_HOST with DNS pointing at the deployment and MEDIA_PUBLIC_IP to the public IPv4 address of the media host. Allow TCP 80/443 and UDP 443 for Caddy, plus TCP 7881 and UDP 7882 for WebRTC. API, PostgreSQL and the SFU signaling port have no published production ports.
3. Supply a CA-signed PostgreSQL certificate with `postgres` in its SAN, its private key, and the CA certificate through the configured secrets files. The API verifies the CA and hostname; PostgreSQL rejects non-TLS TCP clients. Private keys are copied with mode 0600 inside the database container.
4. Check the edge subnet 172.30.10.0/24 does not conflict with existing networks. Caddy uses 172.30.10.2; TRUST_PROXY_CIDR trusts only that address. If changing it, update both values together.
5. Start PostgreSQL, provision restricted roles, apply migrations, then start application services.

```sh
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml up -d postgres
```

For first-time role provisioning, securely populate NOCTIS_API_PASSWORD, NOCTIS_AUTH_PASSWORD, NOCTIS_WORKER_PASSWORD and NOCTIS_MIGRATOR_PASSWORD in the operator environment, matching the database URLs. Run infra/provision.sql as the database administrator without statement echoing. For example on a POSIX shell:

```sh
docker compose --env-file .env.production -f compose.production.yaml exec -T \
  -e NOCTIS_API_PASSWORD -e NOCTIS_AUTH_PASSWORD \
  -e NOCTIS_WORKER_PASSWORD -e NOCTIS_MIGRATOR_PASSWORD \
  postgres psql --no-psqlrc -U postgres -d noctis < infra/provision.sql
docker compose --env-file .env.production -f compose.production.yaml --profile tools run --rm migrate
docker compose --env-file .env.production -f compose.production.yaml up -d --build sfu api worker caddy
```

PowerShell can pipe `Get-Content infra/provision.sql` into the same psql command instead of input redirection. Provisioning is a one-time operation; migrations are ordered and checksummed. Do not edit applied migrations. Production seeding is disabled.

The image runs as node, not root. API and worker use read-only roots, dropped capabilities and a shared persistent upload volume. PostgreSQL uses an internal network. Caddy manages public HTTPS certificates and supports WSS. Keep host access, secrets, image updates and certificate renewal under operator control.

## OAuth and media networking

Configure your GitHub, Google, Spotify and Twitch OAuth applications. Each callback is `https://PUBLIC_HOST/api/oauth/PROVIDER/callback`. Google login, Calendar and YouTube share the configured Google application with distinct requested scopes. Enable the required provider APIs and consent scopes in its console. Provider buttons remain disabled without client ID and secret.

Test consent, rejection, expired state, reconnect, token refresh and disconnect with dedicated provider test accounts before public rollout. The implementation uses fixed provider endpoints and does not expose tokens to the frontend. Removing a connection clears Noctis credentials; users can revoke the grant in the provider account too.

The production Compose runs a pinned LiveKit SFU. Its HTTP/signaling port remains on the private edge network; browsers signal through Noctis, which revalidates their cookie, session, room membership and current permissions before forwarding a freshly signed grant. Expose the configured WebRTC TCP/UDP ports directly and set MEDIA_PUBLIC_IP correctly. Configure LiveKit TURN/TLS or a compatible relay for restrictive networks, then verify voice, video and screen sharing from separate networks. The local browser tests establish direct media transport on one host; they do not prove internet reachability. See the [LiveKit deployment guide](https://docs.livekit.io/transport/self-hosting/deployment/) for firewall, TURN and multi-node topology.

## Backups, recovery and monitoring

Back up PostgreSQL with pg_dump/custom format or managed point-in-time recovery; back up the upload volume and encryption key together. Prefer pg_service/.pgpass or secret-manager injection over passwords in command arguments. Encrypt backups and restrict retention/access. A database-only restore loses file payloads; a lost encryption key makes connected-provider credentials unreadable.

Rehearse restoration into an isolated database with restricted roles, migrations and a copied upload volume. Verify login, membership, private attachment access, reward ledger and audit chain. Avoid automatic schema downgrade; restore a tested database backup when a migration rollback is required.

Health checks: /api/health checks process liveness; /api/ready checks the database. Collect structured application logs, worker job failures and security audit records separately. Alert on repeated 5xx, failed jobs, unusual rate-limit spikes, certificate expiry and database/storage capacity. Raw bodies, cookies, OAuth codes and upload URLs must not be added to proxy access logs.

Run `npm run audit:verify` using the deployment migration connection and verified TLS. Export the returned checkpoint to an independently controlled system. A chain under one database administrator is not an independent integrity guarantee.

Rotate role passwords through the database and secret store before restarting services. Rotating SESSION_SECRET invalidates in-memory CSRF values; revoke sessions explicitly when requiring reauthentication. Rotate ENCRYPTION_KEY only with a tested credential re-encryption or deliberate disconnect/reconnect procedure; replacing it blindly loses access to encrypted tokens. Preserve the old key in an encrypted recovery backup until migration is verified.

## Scaling boundary

API replicas share PostgreSQL invalidations, sessions and rate limits. Caddy resolves all API IPv4 addresses through Docker DNS every five seconds, balances connections and temporarily avoids upstreams returning 503. WebSockets remain on their initial upstream until reconnection. Message nonces make explicit client retries idempotent; do not enable indiscriminate proxy retries for mutations.

Start two replicas on the same host after migrations:

```sh
docker compose --env-file .env.production -f compose.production.yaml up -d --build --scale api=2 sfu api worker caddy
```

Budget database connections before increasing replica count. Defaults allow up to 27 per API process: 15 domain transactions, 5 authentication, 5 supporting worker operations and 2 dedicated listeners. A standalone worker uses up to 5 additional worker connections. Two APIs plus one worker therefore budget 59, before migrations, health checks, operator access and other services. Reserve operational headroom within PostgreSQL's configured max_connections; multiplying API containers without that budget can reduce capacity. API and authentication admission guards reject excessive queued work with HTTP 503 and Retry-After. Pool acquisition has a two-second deadline.

LISTENER_DATABASE_URL must use the restricted API role through a direct or session connection. PostgreSQL LISTEN is session state and must not use transaction pooling. The other pools retain transaction-local identity; introducing a pooler still requires validation with the deployment's TLS, reset and authentication configuration. No pooler or database HA cluster is deployed by this change. See the [node-postgres pooling guidance](https://node-postgres.com/features/pooling) and [PostgreSQL LISTEN reference](https://www.postgresql.org/docs/current/sql-listen.html).

The Compose upload volume is shared between replicas on one host. Multiple hosts need a shared filesystem or an object-storage adapter preserving controlled authorization. Provider workers use leased jobs. Calls have no fixed participant cap in Noctis; the SFU forwards streams and the client renders 12 video tiles per page while keeping room audio subscribed. The included Compose starts one media node. A large public deployment must measure CPU and ingress/egress bandwidth, then add LiveKit nodes with Redis and layer-4 balancing when one host approaches its operating budget. A free host is suitable only if it supports a persistent container and public TCP/UDP media ports; its resource and traffic quotas still determine capacity. Local regression measurements are recorded in PERFORMANCE.md and do not certify a public host.

## Noctis Music worker

The production image includes FFmpeg and the native LiveKit RTC runtime. The worker uses the same LiveKit API credentials as voice, plus database access for durable leases and session transitions. Set `FFMPEG_PATH` only when the executable has a different location. Tune `MUSIC_MAX_QUEUE`, `MUSIC_MAX_TRACK_SECONDS`, `MUSIC_MAX_SOURCE_BYTES`, `MUSIC_FETCH_TIMEOUT_MS` and `MUSIC_IDLE_DISCONNECT_SECONDS` from measured resource budgets.

`MUSIC_AUDIO_HOSTS` is a comma-separated exact-host allowlist for licensed HTTPS audio used by the native LiveKit bot transport. Leave it empty until an approved source is available. YouTube, Spotify and SoundCloud use their official browser players, so their page hosts do not belong in this server-side allowlist. Clients need outbound HTTPS access to the official player origins, and browsers may require one click on **Play here** before audio starts. Spotify decides whether a full track or preview is available for each listener, account, browser and region.

Scale native media capacity from concurrent licensed direct tracks as well as human participants: each active native track adds an FFmpeg process, one LiveKit publisher and an audio stream. Official YouTube, Spotify and SoundCloud players do not add a bot publisher or server-side decoder; the listener's browser connects to the provider. Monitor `music_metrics`, worker lease failures, decoder exits, CPU and SFU egress. Run `npm run test:music-media` against the deployment's LiveKit endpoint before rollout; the local smoke test verifies FFmpeg decoding plumbing and a real RTC audio publication, while public reachability still requires deployment validation.
