# Noctis

A graphite community platform with PostgreSQL persistence, authenticated chat, missions, direct conversations, WebRTC calls, events and server administration. React and TypeScript power the interface; Fastify provides the API and realtime gateway.

## Run locally

Requires Node.js 24, npm and Docker Desktop (Linux containers).

```sh
npm ci
npm run setup:local
docker compose up -d postgres sfu
npm run db:bootstrap
npm run db:seed
npm run dev
```

Open **http://localhost:5173**. Create an account, or use the private `SEED_EMAIL` and `SEED_PASSWORD` generated in `.env` for Alex Morgan's populated demo. Other seed identities have no password. On Windows with restricted PowerShell execution, use `npm.cmd`.

New accounts must confirm their email. With the default local `MAIL_TRANSPORT=file`, the worker writes messages into `STORAGE_PATH/mail`; open the link from the matching local JSON message. These files contain private links and must stay outside the repository. Production uses MailerSend SMTP, configured in `.env.production.example`; see DEPLOYMENT.md. Manage MFA and passwords at `/#/settings/security`.

The API runs on 3001, frontend on 5173, PostgreSQL on localhost:54329 and LiveKit signaling on localhost:17880. WebRTC uses TCP 17881 and UDP 17882. Development starts the web app, API and worker. Setup preserves existing configuration; migrations and demo seeding preserve data. Stop local infrastructure with `docker compose stop postgres sfu` to retain the database volume.

To run the complete local stack in Docker, including migrations, demo seed, the API with its compiled frontend, Music worker, PostgreSQL and LiveKit, use `npm run docker:up` and open **http://localhost:3001**. The command derives a private, ignored `.env.docker` from `.env` without changing host-development URLs. Stop it with `npm run docker:down`; omit `-v` to preserve database and upload volumes.

After editing `.env`, run `npm run docker:up` again to recreate containers with the updated configuration. Restarting existing containers in Docker Desktop keeps their previous environment. The `bootstrap` and `seed` services finish with exit code 0 after initialization; only the API, worker, PostgreSQL and LiveKit keep running.

Database state is authoritative. Browser storage contains unsent drafts only. Development attachments use `STORAGE_PATH`; choose a durable directory outside the application for data you intend to keep. Production uses a persistent upload volume.

## Explore

| Experience                                                   | Entry                                  |
| ------------------------------------------------------------ | -------------------------------------- |
| Authentication and onboarding                                | Sign in / Create account               |
| Home and community activity                                  | `/#/home`                              |
| Channels, messages, replies, reactions, pins, files and GIFs | `/#/server/studio/general`             |
| Member profiles                                              | Member sidebar / avatar                |
| Direct and group conversations                               | `/#/messages`                          |
| Voice, camera and screen sharing                             | `/#/voice/studio/lounge`               |
| Missions, objectives, XP and rewards                         | `/#/missions`                          |
| Server leaderboard                                           | `/#/leaderboard`                       |
| Discovery and creation                                       | `/#/discover` / rail +                 |
| Expiring invitations                                         | Server navigation → Invite your people |
| Events and RSVPs                                             | `/#/events`                            |
| Provider connections                                         | `/#/integrations`                      |
| Notifications                                                | Header bell                            |
| Account, privacy, appearance, devices                        | `/#/settings/account`                  |
| Roles, channels, moderation, audit and webhooks              | `/#/admin/studio`                      |
| Search and commands                                          | Ctrl/⌘ K                               |

Studio routes require membership. New accounts join or create communities. Seed conversations are fictional initial content; subsequent messages, memberships, presence, rewards and edits come from the database.

## Verify

```sh
npm run test:setup
npx playwright install chromium
npm run typecheck
npm run test:api
npm run test:e2e
npm run build
npm run test:load
npm run test:replicas
npm run format:check
```

Tests use the separate `noctis_test` database, ports 3002/5174 and private `.env.test`. They do not reset development data. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use existing Chromium. Media tests use synthetic capture devices with actual WebRTC connections to the local SFU. Traces are disabled to avoid recording credentials.

Run the suites sequentially: browser setup resets test rate buckets. Load tests generate and remove only their own fixture community, users and 10,000 messages. Replica tests require a current build and available loopback ports 33301/33302. PERFORMANCE.md describes the workload and its limits.

## Deployment

[DEPLOYMENT.md](DEPLOYMENT.md) covers HTTPS, database TLS, role provisioning, SFU networking and backups. [ARCHITECTURE.md](ARCHITECTURE.md) describes services and API contracts. [SECURITY.md](SECURITY.md) records security boundaries. [VERIFICATION.md](VERIFICATION.md) records executed checks.

OAuth connections require your provider applications; unconfigured providers stay disabled. Calls use a self-hosted LiveKit SFU with no application-level participant cap. The local regression joins 13 real browser participants and verifies that each browser keeps one WebRTC peer connection. Public capacity depends on the CPU and network available to the SFU deployment. No external accounts are connected automatically. Billing and hosted deployment are not included.

[DESIGN.md](DESIGN.md) and [UX-CONTRACT.md](UX-CONTRACT.md) maintain visual and behavioral contracts. Shared UI lives in `src/components.tsx`; canonical tokens in `src/styles.css`; supporting service layouts in `src/service.css`.

Inter and Manrope use SIL Open Font License (included in `public/fonts`). Bundled demo photography comes from Unsplash, portraits from Pravatar and GIFs from Giphy. Review asset licenses for public distribution. The Noctis mark is project-created.

The requested “Enter home scenario” skill was unavailable. Authenticated users enter Home; private screens require authentication.

## Native Music Bot

Every server has an isolated queue, playback state, volume, repeat mode and Music settings. Members can use slash commands or the player embedded in voice; owners configure member skip/volume, autoplay and the default voice channel under Server Administration. Seven independent role permissions cover transport and queue actions. State is durable in PostgreSQL and realtime updates are server-scoped. Official-provider embeds stream to each listener; a leased worker publishes licensed direct sources as a native LiveKit participant.

YouTube, Spotify and SoundCloud play through their official embedded players directly to each listener, with no download, extraction or server rebroadcast. Noctis synchronizes the shared queue and controls; browsers may require one click on **Play here**, and Spotify controls whether a full track or preview is available. Direct playback through the native LiveKit bot accepts only licensed HTTPS media from exact hosts listed in `MUSIC_AUDIO_HOSTS`. The production container includes FFmpeg. Run `npm run test:music-media` with LiveKit running to verify native audio publication.
