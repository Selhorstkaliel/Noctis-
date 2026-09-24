---
version: alpha
name: Noctis
description: A graphite social club for communities, conversations, and shared ambition.
colors:
  primary: "#aaa2ff"
  background: "#0c0d10"
  surface: "#141519"
  elevated: "#1b1c22"
  border: "#292a32"
  text: "#f1f1f4"
  muted: "#a2a3ae"
  success: "#75c7a5"
  danger: "#f28f98"
typography:
  sans:
    fontFamily: "Inter, Segoe UI, sans-serif"
  display:
    fontFamily: "Manrope, Segoe UI, sans-serif"
  mono:
    fontFamily: "Consolas, monospace"
rounded:
  DEFAULT: "0.625rem"
  sm: "0.375rem"
  md: "0.625rem"
  lg: "0.875rem"
spacing:
  section-gap: "1.75rem"
  page-max: "100rem"
components:
  button: {}
  card: {}
  dialog: {}
  avatar: {}
  field: {}
  badge: {}
---

# Noctis Design System

## Overview

### Creative North Star

The quiet interior of a performance grand tourer at dusk: graphite instruments, restrained illumination, panoramic scenery. The social content supplies the warmth.

### Product context and register

- Audience: international friends, creative communities, teams, and gaming groups.
- Market evidence: user's English-language brief; no specific national market requirement.
- Locale: en-US and pt-BR, chosen at sign-in or in account settings and persisted to the account; browser-local timestamps follow the selected language.
- Usage: frequent desktop sessions, a 1440px primary composition, tablet and mobile access.
- Register: product for authenticated pages; cinematic brand treatment for sign-in.
- Signature: a panoramic misty mountain banner integrated into a precise community dashboard.
- Restraint: matte surfaces, small line icons, no neon glows, no decorative charts.
- Anti-references: AI assistant interfaces, oversized marketing cards, saturated gaming dashboards.
- Token ownership: `src/styles.css` is the canonical runtime source. This file mirrors its named `:root` tokens; edit both together. Components consume the runtime CSS variables directly, with no theme adapter.

## Colors

Background, surface, and elevated values establish three levels of graphite. Border defines hairline separation. Text and muted preserve legibility. Primary iris marks selection and key actions; success mint marks presence and completion. Danger rose marks removal and disconnect. A lighter graphite appearance variant changes the surface tokens without changing semantic roles. Forced colors uses system colors.

## Typography

Manrope carries the wordmark, greetings, and section titles. Inter carries content and controls, with Segoe UI as a metric-friendly local fallback. Consolas marks keyboard shortcuts. Body uses 13â€“14px with 1.55 line height; display uses 30â€“42px with tightened tracking. Counters use tabular numerals. Heading case is sentence case except the tracked Noctis wordmark and small category labels.

## Layout

72px server rail, 224px navigation, flexible content, 284px contextual sidebar. Main content has 28px gutters and 28px section gaps. Below 1200px the right sidebar moves into normal flow. Below 900px navigation contracts; below 640px it becomes a modal drawer. One canonical content scroller owns each page, chat has an independently scrolling transcript. Media has reserved geometry. No horizontal document overflow.

## Elevation & Depth

Hairline borders and tonal changes establish hierarchy. Shadows belong to overlays. Glass is restrained to the hero label, header, and voice controls. Standard cards have no glow. Media is darkened for contrast.

Active calls remain present while people move through the product. A compact graphite dock sits at the bottom of the workspace with the room identity, connection time and the same familiar media controls. It uses one soft top shadow and a restrained mint signal so the call is visible without competing with the conversation.

Screen sharing asks whether to include source audio before opening the browser picker. The two choices use the standard dialog and clearly state that audio availability still depends on the tab, window, or screen selected in the browser. Shared-screen audio remains separate from the microphone so muting a member does not silence media they intentionally share.

The music bot and shared screens use the same card geometry as people. Provider video lives inside the bot card with a dark lower scrim for identity, while every screen share gets a quiet glass toolbar for live state and expansion. The `#general` music strip stays horizontal and compact so transport controls remain close without displacing the transcript.

## Shapes

Controls use sm radius; cards use lg; dialogs use 18px. Avatars are circular, server marks are softened squares. Dividers are 1px. Do not put every icon in a colored tile.

## Components

### Foundational visual states

All buttons have hover, active, disabled, and visible focus states. Selected navigation has a quiet iris tint. Busy controls preserve dimensions; errors use persistent inline text. Loading uses the shared spinner. Reduced motion removes transforms and ambient animation.

### Buttons and actions

Shared Button supports primary, secondary, ghost, danger; IconButton has accessible names and native tooltips. Minimum control height is 36px, 40px on mobile. Dangerous actions are visually separated.

### Navigation and data display

Anchored route navigation uses hash paths and browser history. Bounded API lists, message pagination, search and filters have explicit empty states. Badges use a label with optional icon; never rely only on color.

### Forms and overlays

Field, SearchInput, Dialog, and Toast are canonical shared primitives. Native select/date controls deliberately retain platform-owned popups. Dialog uses native modal semantics, focus containment, Escape, and restored focus. Forms retain draft values and validate inline. Uploads use a real picker and size/type validation.

The shared Popover is a compact elevated graphite surface anchored to its trigger, with the existing border, large radius and overlay shadow. It uses `--z-popover: 80`, below global notifications and native modal dialogs. Pinned messages use a 360px-wide panel, bounded to the viewport and 420px in height, with a fixed heading and internal list scrolling. Author, date and a short message preview lead to the original message; the conversation stays visible and interactive.

Account security extends Field through the shared SecretField with a labeled reveal control. Confirmation, recovery and MFA pages use the same graphite panel, Manrope headings and iris actions as account settings. The QR code is the sole high-contrast utility surface and keeps fixed square geometry. Recovery codes remain hidden until explicitly revealed and require a saved acknowledgment before completion. No security secret is persisted in client storage. SecuritySettings owns MFA and ChangePassword; the devices screen links to this canonical section.

### Iconography

Lucide, 1.7px strokes; 18px navigation, 16px inline, 20px controls. Branded server marks are typographic; never emoji substitutes for navigation icons.

### Motion

160ms feedback, 220ms page transitions, 260ms dialogs. Easing is cubic-bezier(.2,.7,.2,1). Voice activity is slow and low amplitude. Mission completion uses a brief ring/check animation. Respect prefers-reduced-motion and the user setting.

### Content and data visualization

Conversational, specific copy. Mission bars always include objective counts. XP uses locale-formatted numbers. Presence includes readable status. Server snapshots keep cards, details, profiles, badges and leaderboards consistent; seed content is initial development data only.

## Do's and Don'ts

- Do give conversations and people more emphasis than metrics.
- Do reuse shared geometry and feedback across screens.
- Don't use overwhelming gradients, neon decoration, or AI language.
- Show provider connections only after verified OAuth completion. Unconfigured providers remain disabled.

## Native music surface

The music player is a calm server surface, not a separate branded application. It uses the existing graphite panels, thin borders, iris accent and compact Lucide controls. Artwork, title, provider and playback state form the first reading line; progress, transport and volume follow in that order. Queue rows preserve stable height, expose the requester and duration, and reveal management actions without shifting surrounding content.

The same player component appears in chat dialogs and joined voice rooms. Loading preserves its footprint and permission failures remain inline. YouTube, Spotify and SoundCloud links open inside a restrained official-player surface within the shared player; a clear **Play here** action handles browser autoplay restrictions. Active playback may animate the state indicator and progress bar at low amplitude; reduced motion stops nonessential animation. Every icon control has a readable name, focus ring and disabled state.

