# UX Contract

## Product context

International English- and Portuguese-speaking communities, creative teams and friends. Locales en-US and pt-BR, Gregorian calendar, browser-local timezone. Language is chosen on sign-in or in account settings, saved per account, and applied to document language, navigation and product controls. WCAG 2.2 AA is the target. This is an authenticated PostgreSQL-backed application. PRODUCT.md and the user's backend/security brief are authoritative, reviewed September 9, 2026.

## Canonical UI Map

| Capability     | Canonical owner                                | Source of truth                | Allowed variants               | Verification               |
| -------------- | ---------------------------------------------- | ------------------------------ | ------------------------------ | -------------------------- |
| Select/Listbox | Field + native select, src/components.tsx      | UX contract                    | Platform popup                 | Keyboard / browser         |
| Date           | Field + datetime-local                         | API timestamps / UX            | Native picker                  | Event forms                |
| Form           | Field / Button                                 | Domain schemas                 | Create / edit / authentication | Browser / API              |
| Scrollbar      | src/styles.css                                 | DESIGN.md                      | Compact navigation             | Layout inspection          |
| Toast          | Toast / UIContext                              | UX contract                    | Success / info / error         | Live region                |
| CRUD           | src/store.ts commands + server domain routes   | PRODUCT.md / API               | Modal return / detail stay     | Browser / API              |
| Dialog         | Dialog                                         | UX contract                    | Modal / wide                   | Focus / Escape             |
| Popover        | src/Popover.tsx                                | UX contract                    | Non-modal pinned messages      | Keyboard / viewport bounds |
| Search         | SearchInput + server search                    | Object authorization           | Global / conversation          | Clear / authorized results |
| Permissions    | ServerAdmin + domain authorization             | PostgreSQL roles and overrides | Owner / effective capabilities | Adversarial API tests      |
| Media          | VoiceRoom + realtime gateway                   | Participant authorization      | Audio / camera / screen        | Two-browser WebRTC         |
| Private files  | fileFromUrl + uploadFile + controlled endpoint | Server storage policy          | Avatar / attachment            | API signature/access tests |

No bulk selection workflow is exposed. Native select and date popups retain platform ownership.

Account security is owned by `src/Security.tsx` (SecretField, SecurityRoute, SecuritySettings, ChangePassword), `server/account-security.ts`, `server/auth.ts`, and migration 015. It reuses Field, Button, Dialog and the existing locale provider. See SECURITY.md for token, session and factor policies. Registration pauses at email verification; only confirmed accounts continue to onboarding or the saved invitation. Both password and provider login show the same MFA step. MFA and recovery secrets stay in component memory; links are cleared from the address bar. Success follows the committed server response. Canceling unfinished setup or discarding unsaved recovery codes requires confirmation. All owned copy, error feedback and accessibility labels follow en-US/pt-BR. The devices screen links to account security instead of maintaining a separate password form.

## Interaction states

Buttons/anchors provide focus, hover, pressed and disabled semantics. Inputs are labeled; search has immediate clear with focus return. Textareas do not resize. Pending operations retain layout. Destructive actions require an explicit action and appropriate confirmation/reason; message deletion offers a 15-second Undo.

Forms preserve input on server rejection and show actionable errors. Success feedback follows persisted success, not an optimistic permission decision. Account settings guard unsaved edits. Composer drafts are transient session storage; authentication and authorization never depend on them. Unsent attachments and in-flight sends have an unload guard.

Dialogs trap focus, close with Escape and return focus to their opener or a meaningful destination. Ctrl/⌘ K opens search; Ctrl/⌘ comma opens settings. Reduced motion and forced colors are supported.

Pinned messages open in a compact non-modal Popover anchored to the chat header button in channels and direct conversations. The transcript, composer draft and scroll position remain in place. The panel has its own bounded scroller, fits the viewport and flips above the button when needed. Escape and the close button restore focus to the opener; outside interaction dismisses without stealing focus. Selecting a message closes the panel and focuses that message in the transcript. Changing rooms closes the panel.

## Data and navigation

Hash routes preserve destinations. Private routes require a valid session. Unauthenticated invitations retain a pending destination through login. New identities complete interests onboarding; seeded Alex enters Home after real authentication.

Lists use bounded API queries; earlier messages have pagination and search-context loading. No-result/empty/error states explain a next action. Member counts, badge awards, event attendance and presence derive from database state. Unconfigured integrations are disabled with setup context. Expired invites, denied channels, invalid uploads and revoked sessions do not silently appear successful.

API errors produce safe inline/toast feedback. Realtime disconnection shows reconnection state. Revocation clears private identity state; pending snapshots from an older session cannot restore it. Media capture is explicit, starts muted, and stops on leave/unmount or loss of authorization.

Profile photos accept JPG, PNG, and WebP files up to 2000 KB. The browser and upload endpoint enforce the same limit before the server validates, reorients, resizes, and converts the image to WebP.

Local file previews are decoded directly before upload, without a network request to a data URL. Account settings retain the selected photo after a failed save and expose a localized inline error and retry through Save changes. Pending saves disable repeat submissions; success requires the saved profile to be read back from the server. Duplicate registration uses the same generic message for email and username conflicts and offers sign-in and password recovery without identifying the conflicting field.

Chat mutations synchronize affected message IDs through the canonical store; they do not reload the account snapshot. Missing IDs remove only messages in the requested room. Read markers refresh unread activity independently. Per-room requests coalesce and recheck their snapshot generation before publication. Reconnection and permission changes still fetch authoritative state. A browser regression verifies message creation, editing and deletion without bootstrap requests.

## Flow ledger

| Operation                      | Pending          | Success                                   | Failure recovery                      |
| ------------------------------ | ---------------- | ----------------------------------------- | ------------------------------------- |
| Sign in/register               | Submit disabled  | Home / onboarding / pending invite        | Generic safe error, retain email      |
| Create community/mission/event | Submit disabled  | Owning list/detail + toast                | Preserve form and show API error      |
| Edit profile/privacy           | Save pending     | Server snapshot + toast                   | Preserve draft                        |
| Message/reply/file             | Composer pending | Persisted transcript                      | Retain content and retry              |
| Claim reward                   | Action pending   | Backend XP/badge + completion state       | Preserve objective state, show denial |
| Role/moderation change         | Action pending   | Authoritative refresh + audit             | Preserve effective permissions        |
| Invite                         | Creation pending | Expiring link / notification              | Expired/revoked state, create another |
| Provider connect               | OAuth navigation | Provider callback + worker state          | Disabled/not configured or reconnect  |
| Voice/media                    | Capture pending  | Actual peer media + participant flags     | Permission/network error, rejoin      |
| Session revocation             | Action pending   | Device removed / current identity cleared | Safe error, retry                     |

## Verification

See VERIFICATION.md for executed checks and limits. tests/live.spec.ts covers browser workflows and accessibility; server/tests/security.test.ts checks actual PostgreSQL authorization, sessions, uploads, rewards and realtime behavior. Design tokens remain owned by src/styles.css and mirrored in DESIGN.md.

## Music commands and player

`/play` without an argument opens a focused source dialog. `/play <URL or terms>`, `/pause`, `/resume`, `/pass`, `/skip`, `/stop`, `/volume`, `/queue`, `/nowplaying`, `/remove`, `/clear`, `/shuffle`, `/repeat` and `/move` use the same permission-checked server session as player buttons. Successful commands update through scoped `music:*` realtime events; the client also resynchronizes the authoritative session every 15 seconds while the player is open.

Joining a voice room reveals the server player. Licensed direct sources arrive through the existing LiveKit room. YouTube, Spotify and SoundCloud stream from their official player to each participant while Noctis synchronizes the shared transport state. A listener may need to press **Play here** once because browsers control autoplay, and provider account, region and catalog rules continue to apply locally. Empty queues, idle sessions, denied controls, decoder failures and reconnecting realtime each show a specific recoverable state. Queue pagination never implies that only the visible page exists.

An active voice session survives navigation throughout Noctis and continues when the browser tab is in the background. Other screens expose a compact call dock with the room, elapsed time, media state, mute, deafen, camera, screen-sharing and leave controls. Selecting the room returns to the full participant view without reconnecting. Only an explicit leave, lost authorization, expired session or unrecoverable media disconnect ends the call.

Entering a server switches the secondary sidebar to that server's context. It lists only the server's categorized text and voice channels, plus its invite and administration actions; global Home, direct messages, missions, events, discovery and integrations links return only after leaving the server through the server rail.

The administration action always targets the current server and remembers the last valid server context for the browser session. Legacy or stale administration links that contain a placeholder server identifier are normalized to that remembered server when the member still has administrative access.

Noctis Music occupies a participant card while a member is in the voice room. Official YouTube, Spotify and SoundCloud playback stays inside that card; native licensed audio uses the same bot identity. The server's `#general` channel exposes synchronized repeat, pause/resume, skip, stop, volume, queue and add-track controls. Permissions continue to be enforced by the server for every action.
The mounted participant card and its official provider player remain alive offscreen while the member reads chat, visits missions, or moves to another product route. Navigation does not recreate the provider iframe or reset its playback state. Browser autoplay and provider restrictions still apply when a member first starts playback.

Each active screen share creates its own participant-sized card in the call grid, including simultaneous shares. A member may expand any share over the application and return it to the grid without interrupting the stream. Microphones start with browser noise suppression, echo cancellation and automatic gain control enabled; the noise suppression control applies changes to the live audio track and remembers the device preference.
