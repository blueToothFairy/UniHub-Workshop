# UI Design Guidelines - UniHub Workshop

This file defines the visual direction for the current UniHub web app.

## 1. Design Direction
- Tone: modern, clean, bright, energetic, and trustworthy.
- Character: light backgrounds, soft gradients, strong typography, rounded cards, and clear hierarchy.
- Brand feel: practical education platform with bold call-to-actions.

## 2. Core Tokens
- `--color-accent`: `#c6ff4d`
- `--color-accent-deep`: `#96d62b`
- `--color-primary`: `#16181d`
- `--color-bg`: `#f6f8fc`
- `--color-surface`: `#ffffff`
- `--color-surface-soft`: `#eef3ff`
- `--color-muted`: `#5d6675`
- `--color-border`: `#dce3f0`

Spacing scale (4px system): `4, 8, 12, 16, 24, 32, 48, 64`

Radius scale:
- small: 10px
- medium: 16px
- large: 24px
- pill: 9999px

Shadows:
- soft card shadow for default cards
- stronger lift shadow on major CTAs only

## 3. Typography
- Primary family: `Plus Jakarta Sans` fallback to `Segoe UI`, `Avenir Next`, `Noto Sans`, sans-serif.
- Hero heading: `clamp(2rem, 4vw, 3rem)`, bold.
- Section heading: strong 600-700 weight.
- Body text: 16px equivalent with relaxed line-height (~1.6).
- Muted metadata uses `--color-muted`.

## 4. Layout Patterns
- Page shell: bright gradient background with subtle radial accents.
- Marketing pages: hero split layout (`1.2fr / 1fr`) on desktop, stacked on mobile.
- Admin pages: fixed sidebar + content panel.
- Cards and tables use generous padding and breathing space.

## 5. Components
- Buttons:
  - `btn-primary`: dark filled pill with shadow.
  - `btn-secondary`: soft surface pill with border.
  - `btn-danger`: soft red surface for destructive actions.
- Header:
  - Auth-aware nav controls: unauthenticated users see `Sign up` + `Log in`; authenticated users see notification icon + `Logout`.
  - Notification trigger should feel compact and tool-like (rectangular/rounded-square), not capsule-pill.
- Cards:
  - rounded (`16px`), bordered, semi-elevated.
- Notification inbox dropdown:
  - Opens from header icon and uses a scrollable list container (fixed max-height + vertical overflow).
  - Unread items must be visually elevated using richer gradients/depth and bolder title text.
  - Avoid pill-style unread chips and avoid thin-outline-only cards; prefer solid blocks and shadow hierarchy.
- Workshop list cards:
  - Avoid showing long descriptions in the workshop grid card.
  - Prioritize concise metadata: date/time, speaker, room, and availability.
  - Use expressive card surfaces (gradient + accent edge), not thin-border-only blocks.
- Data tables:
  - compact header, subtle row hover, border separators.
- Status badges:
  - `success`, `pending`, `fallback` visual variants.
  - Avoid pastel "AI-like" capsules.
  - Prefer compact micro-badges with a clear border, uppercase label, and a small status dot.
  - Keep tones grounded and contrast high against white/light cards.

## 6. Motion
- Keep interactions subtle (`180ms` transitions).
- Add slight lift on hover for button/card affordance.
- Respect `prefers-reduced-motion` by disabling transitions/animations.

## 7. Accessibility
- Keep contrast WCAG AA for body text.
- Maintain keyboard-visible focus ring.
- Do not use accent green for long body text.
- Ensure interactive targets are comfortably clickable (>= 40px high).

## 8. Responsive Rules
- `< 640px`: single-column layouts, compact spacing.
- `640px - 1024px`: 2-column grids where possible.
- `> 1024px`: full hero split, 3-column data cards.

## 9. Implementation Notes
- Prefer utility classes from `frontend/app/globals.css` for consistency.
- Avoid inline style except for one-off dynamic values.
- New screens should reuse existing classes (`card`, `btn`, `stat-grid`, `data-table`, `form-2col`, etc.).

## 10. Quick QA Checklist
- Visual hierarchy is clear in first glance.
- Hero and CTA sections feel impactful, not flat.
- All forms, tables, and cards remain readable on mobile.
- Focus states and error states are visible.
