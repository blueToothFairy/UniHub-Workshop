UI Design Guidelines — UniHub Workshop

This document captures the visual and interaction design principles derived from the supplied screenshots and the project context (UniHub Workshop). Use this as the canonical guide for UI decisions across the frontend codebase.

1. Overview
- Purpose: provide a concise, accessible, and consistent visual language for marketing pages, admin screens, and student-facing flows.
- Tone: clean, modern, and utilitarian with high emphasis on whitespace and clear information hierarchy.
- Primary use cases observed: landing/FAQ page, feature grid, admin dashboard (stat cards + activity feed), and strong footer/CTA band.

2. Visual Identity (tokens)
- Brand accent: vivid lime/green — used for large-area CTAs and footer backgrounds to create a strong brand band.
- Neutral palette: white background, subtle light-gray surfaces, medium-gray copy for secondary text, near-black for body/heading copy.
- Semantic colors:
  - `--color-accent` : #bfff3f (example bright green used in screenshots; adjust to final brand value)
  - `--color-primary` : #111111 (primary text)
  - `--color-muted` : #6b7280 (muted text / subcopy)
  - `--color-bg` : #ffffff
  - `--color-surface` : #f5f5f7
  - `--color-danger` : #c53030
- Spacing scale: use a 4px-based scale (4, 8, 12, 16, 24, 32, 48, 64) for consistent margins and paddings.
- Radii & elevation:
  - Border radius: 8px for cards, 6px for small UI elements, 9999px for pills.
  - Shadow levels: none (flat) for most cards; soft elevation for hero screenshot card (e.g., 0 6px 18px rgba(0,0,0,0.08)).

3. Typography
- Font stack: system sans-serif or an explicit geometric sans for headings.
- Hierarchy:
  - H1/Large headings: 32–40px, 700 weight
  - H2/Subhead: 20–28px, 600 weight
  - Body: 16px, 400 weight
  - Small/caption: 12–14px, 400 weight, `--color-muted` for subdued copy
- Line lengths: aim for 60–80 characters per line for body copy on content columns.

4. Layout patterns
- Global layout: generous outer margins and a centered content column for pages; two-column hero where a screenshot sits beside text (collapses on small screens).
- Grid: responsive grid that collapses at 640px — components are designed to flow from multi-column to single column.
- Sidebar (admin): fixed-width sidebar (~220px) with simple vertical navigation and clear grouping.
- Footer: large, full-width brand-color band with multi-column link groups, center CTA, and compact legal row.

5. Core components & rules
- Button
  - Primary: filled (dark) or bright accent depending on background context — ensure high contrast on accent band (prefer dark button on bright band).
  - Secondary: outline or subtle surface-filled
  - Padding: comfortable tap targets (min 40px height)
  - Focus: visible 2px outline offset (not relying on browser default only)

- Card
  - Use for stat cards, feature tiles, and small surfaces.
  - Include title, metric/content area, and an optional action/link.
  - Use consistent padding and typography scale.

- Accordion (FAQ)
  - Compact row with question text and subtle chevron icon
  - Expanded panel uses surface background with a small elevation, animated height transition, and preserves focus order
  - Keyboard: support Enter/Space to toggle, and arrow-key navigation if multiple items

- Feature Grid / Tiles
  - Small cards with icon (rounded/outlined), short title, and one-line description
  - Balanced whitespace between tiles; 3–4 columns on wide screens, collapses to 1 column on small viewports

- Stat Card
  - Large numeric metric, label, optional sparkline or delta
  - Lightweight background with clear numerical hierarchy

- Activity Feed / Alerts
  - Compact list items with title, small timestamp, and optional secondary copy
  - Alerts use semantic color accents (warning/error/info) and a dismiss action (persist dismissal per user if appropriate)

- Navigation
  - Top navigation (marketing): links, small secondary actions (`Log in`, `Sign up`) aligned right
  - Admin navigation (sidebar): vertical list, grouped sections, highlight active item, accessible keyboard focus

6. Interaction & motion
- Micro-interactions: subtle hover lifts and color changes for links and interactive cards
- Motion: quick, unobtrusive transitions (150–220ms) for hover/accordion/route feedback
- Loading states: skeleton blocks for cards and lists; avoid jarring layout shifts by reserving space

7. Accessibility
- Color contrast: ensure body/heading text contrast meets WCAG AA against background; avoid using the bright accent color for body text.
- Keyboard support: all interactive components (buttons, links, accordions, modal dialogs) must be keyboard accessible and have visible focus indicators.
- Aria semantics: accordion panels should use `aria-expanded` and `role="region"`, assume screen-reader friendly structure for navigation landmarks (header, main, nav, footer).
- Motion preferences: respect `prefers-reduced-motion` and reduce animations accordingly.

8. Responsive behavior
- Breakpoints (recommended):
  - small < 640px: single column; stacked hero; mobile-friendly nav (hamburger)
  - medium 640–1024px: two-column content; 2–3 grid columns
  - large > 1024px: full-width layouts, hero with image alongside copy
- Footer CTA: stack vertically on small screens, remain multi-column on large screens

9. Assets & imagery
- Dashboard screenshots should be shown within devices or framed cards with small shadow
- Use SVG icons (single-color) and keep them at consistent 24–32px sizes inside circular or square icon holders
- Images must be optimized and responsive (`srcset` or modern Next/Image usage)

10. Component library guidance (implementation notes)
- Create an atomic set of components: `Button`, `Card`, `Accordion`, `StatCard`, `Alert`, `Navbar`, `Footer`, `Sidebar`, `Grid`.
- Prefer CSS Variables for tokens (colors, spacing, radii) so they are easily adjustable across the app. Example variables live in a simple `:root` token file.
- Prefer server-safe rendering for critical UI (Next.js App Router usage already present); keep interactive pieces as client components.
- Keep presentational components pure and small; compose them in page-level containers.

11. Testing & QA
- Visual regression (Storybook + Chromatic or other snapshot tool).
- Unit tests for interactive components (accordion toggles, button behavior, stat card rendering).
- Accessibility checks: axe-core / vitest + jest DOM a11y assertions.

12. Localization and copy
- Keep copy strings externalized in a `locales/` directory.
- For bilingual (English / Vietnamese) content, ensure text lengths are tested in layout (Vietnamese can be longer).

13. Migration notes for current codebase
- The repo contains simple presentational components and inline style usage; gradually refactor to use the token system above.
- Replace `document.cookie`-based token setting with server-set HttpOnly cookies for security (auth guidance). Use the UI tokens and components when rewriting login forms and admin pages.

14. Quick checklist for implementing a new screen
- Use the token values for color, spacing, and radius
- Confirm semantic HTML (header/main/nav/footer)
- Ensure keyboard and screen-reader support for all controls
- Add unit and visual test for the new component

----

If you want, I can now:
- Convert the token examples into a ready-to-use CSS variables file (e.g., `frontend/styles/tokens.css`).
- Add a small `components/ui` scaffold and a Storybook story for `DashboardStatCard` and `Accordion`.

File created: [UI_DESIGN.md](UI_DESIGN.md)
