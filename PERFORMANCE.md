# Performance verification

Measured September 11, 2026, Node.js 24.14.0 on Windows, PostgreSQL 18.6 and LiveKit 1.9.12 in local Docker. HTTP, WebSocket and media signaling traffic used loopback. This is a repeatable regression workload, not a maximum-user estimate or a production capacity certification.

## Changes

- Chat notifications contain changed message IDs. Sending, editing, reacting, pinning, deleting and restoring fetch only affected room messages and visible author profiles. Read receipts fetch unread activity separately. The browser regression confirms that sending, editing and deleting do not call `/bootstrap`.
- Realtime uses topic indexes and server dependencies instead of revalidating every connected peer on every message. Per-peer delivery queues coalesce notifications, serialize a peer's work, and cap concurrent delivery tasks at four by default. Signaling has a separate two-task queue. Both queues have a 4,096-key pending limit; inbound frames have a 32-frame per-socket limit. Overload closes affected sockets for authoritative resynchronization.
- Two dedicated LISTEN connections no longer occupy request-pool slots. Request pools have acquisition deadlines and admission guards. Session authentication skips the redundant last-seen UPDATE when the row was recently touched, while still checking the session in PostgreSQL on every authenticated request.
- Initial chat history uses indexed room reads. Unread counting verifies the current session and exact room before aggregating inside a restricted function; message content remains protected by RLS. Presence has user/time and voice-room/time indexes. DM unread counts use one query instead of one query per conversation.
- The authenticated profile is always included in the initial 500-profile window, and message authors load on demand. The active channel or DM takes priority when the subscription limit is reached.
- Production Caddy discovers API replicas through Docker DNS. Two independent API processes passed shared-session, cross-instance delivery and remote revocation checks.

## Final recorded workload

The test creates a community with 503 visible profiles and 10,000 historical messages. Each HTTP variant performs three warm-ups and 40 measured requests at concurrency eight. Authentication, rate limits and RLS remain enabled. Snapshot and delta are different scopes of work on the same optimized backend; the table does not claim identical requests before and after a code change.

| Measurement                   | Full account snapshot | One-message room update |
| ----------------------------- | --------------------: | ----------------------: |
| p50                           |                708 ms |                   79 ms |
| p95                           |                920 ms |                  102 ms |
| Average uncompressed response |         208,113 bytes |               580 bytes |
| Completed requests/second     |                 10.57 |                   96.60 |
| Errors                        |                  0/40 |                    0/40 |

In this workload, replacing the account snapshot with a room update reduced response bytes by 99.7% and p95 latency by 88.9%. This is per-update improvement, not a claim of nine times as many supported users.

The same run connected 12 real WebSockets: six subscribed to the room, six unrelated. All six recipients received each of ten messages. The slowest-recipient p95 was 157 ms from starting the write request; unrelated connections received zero message invalidations. Unit coverage separately feeds 1,000 notifications across 20 peer keys: it delivers every item in 20 merged batches, with the configured concurrency bound. Slow-peer isolation and explicit overflow are tested.

An earlier probe on this fixture found channel unread and global history queries taking approximately 3.3–4 seconds each; concurrent full snapshots exceeded the HTTP connection deadline. The indexed room reads and authorized aggregate removed that observed failure. Those diagnostic samples are not a controlled historical benchmark.

## Reproduce

```sh
npm run test:setup
npm run test:api
npm run test:e2e
npm run build
npm run test:replicas
npm run test:load
```

Run these sequentially on an otherwise idle machine. The load script writes `.runtime/load-report.json` and removes only its own fixture identifiers. `PROFILE_LOAD=true` prints query templates exceeding 100 ms, without parameters. Use the distinct test database; never direct these fixtures at production. Replica checks use loopback ports 33301 and 33302 and stop the processes they start.

## Capacity validation

The test is short, single-host and has only 12 connected sockets; 503 visible profiles are not 503 concurrent users. It excludes public-network latency, TLS overhead, a sustained write storm, many active communities, uploads under load, geographic replication, database failover and media load. Establish acceptable p95/error/queue limits and run a sustained workload on the intended hosting before setting a public concurrency target.

Voice uses a LiveKit SFU. A local functional run joined 13 real Chromium participants to one room; LiveKit reported all 13 and each browser maintained one active WebRTC peer connection instead of one connection per other member. A separate two-browser run transmitted synthetic microphone, camera and screen-share tracks. The client retries temporary initial transport failures and LiveKit handles established-session reconnection. The test verifies the SFU architecture and absence of an application room-size cap; the selected public host determines measurable throughput. Multiple-host API deployment still requires shared private storage or an object-storage adapter. PostgreSQL is a shared dependency, and NOTIFY is an ephemeral invalidation bus, not a durable event log. Connection budgets, recovery, monitoring and infrastructure configuration remain operational requirements; see DEPLOYMENT.md.
