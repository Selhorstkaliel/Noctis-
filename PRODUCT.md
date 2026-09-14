# Noctis product contract

Sources: the original product brief and subsequent backend, PostgreSQL and Zero Trust requirements, reviewed September 9, 2026. This replaces the earlier browser-only prototype scope.

Noctis serves international communities, friends, creative teams and gaming groups. English interface, desktop first, with tablet/mobile navigation. Quiet graphite surfaces, restrained iris accents, panoramic photography and precise typography establish its identity.

## Runtime behavior

Authentication gates private screens. Registration creates an identity, requires email ownership confirmation, and then continues to interest onboarding. Returning users enter Home after completing enabled MFA. Invites preserve their destination through sign-in. Account security supports authenticator enrollment, single-use recovery codes and password recovery through MailerSend; email recovery cannot bypass MFA. Demo seeding is explicit development configuration.

Communities contain members, ordered categories, text/voice channels, role assignments and overrides. Public communities appear in discovery. Authorized administrators edit names, descriptions, short icon marks and curated banners. Arbitrary custom server-image uploads are not included; custom profile image uploads are supported.

Messages support durable replies, scoped mentions, reactions, edits, pins, GIF/image and text attachments. Soft deletion has a 15-second undo window. Direct/group conversations enforce contact preferences and blocks. Search and pagination read authorized database records.

Missions have ordered objectives, self/moderator verification, membership, deadlines, rewards and badges. The backend calculates completion and awards XP; a unique reward ledger makes concurrent claims idempotent. Leaderboards aggregate by server and all-time/current-week period. Events persist absolute timestamps and RSVPs.

Voice admits authorized connections through the Noctis media gateway and LiveKit SFU, initially muted and without a fixed application room cap. Capture requires explicit action. Leaving stops tracks and closes the SFU connection. Permission and session changes revalidate connected participants and update SFU publish/subscribe grants.

## Permissions and lifecycle

Owner authority derives from server ownership. Admin/moderator/member roles configure granular permissions. Nonowners cannot assign equal/higher ranks or absent permissions. Ownership transfer is not exposed; owners cannot leave through the membership action.

Account/session state, privacy, memberships, messages, missions, rewards, events, notifications and provider connections persist in PostgreSQL. Browser drafts are convenience state only. Mutations validate identity, permissions, payload and relevant abuse limits. Failed saves preserve editable input; completion feedback follows API success.

## External configuration

OAuth needs operator credentials and registered callbacks. Provider success is never simulated. Webhooks use generated HMAC credentials. Database/uploads need backups; TLS, DNS, public WebRTC ports and restrictive-network relay support require deployment configuration. Email ownership verification/recovery, MFA and account export/deletion remain follow-up capabilities.
