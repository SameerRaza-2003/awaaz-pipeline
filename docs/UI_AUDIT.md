# UI audit (before redesign)

Captured with Playwright at 390 px and 1440 px against a live-mode backend with every outbound channel unconfigured, so
"Not set up" states are real. Screenshots: `docs/ui-shots/before/` (git-ignored). Automated check: axe-core 4.10 on every
page and state.

## Generic "AI output" signals

- The logo is a letter "A" in a rounded green square. It says nothing about the product.
- Every block is a white rounded card with a border, and cards sit inside cards (chat panel > emergency card > status rows,
  chat panel > draft card > footer). Hierarchy comes from boxes, not from type size or weight.
- The start screen explains itself with three icon + bold title + paragraph rows: the familiar three-feature pattern.
- The workflow graph tints each lane with a different accent (red, green, blue, amber, teal). It is decorative colour, and
  the red is the colour that should mean "danger".
- A progress card and a minimap float over the graph, adding chrome that carries little information.
- IBM Plex Sans everywhere: competent, but it gives the product no voice.

## Inconsistencies

- Type: 15 different sizes in use, many arbitrary (10, 11, 11.5, 12, 13, 15 px...). Agent nodes render at about 9 px
  after the graph fits itself to the panel.
- Radius: full pills, 2xl bubbles, xl cards, lg buttons, md tags, all at the same level of hierarchy.
- Colour roles overlap. Green is the brand, the primary button, "done" and "safe". Red is "Yes", "Get help now", "Call now",
  error text and a lane tint. Blue appears for "running" only in the graph.
- Spacing has no rhythm between chat, cards and drawers (12, 14, 16, 18, 20 px paddings side by side).
- The step indicator labels the interview "Your account", which collides with the "account" (login) feature.
- The police tool reuses the survivor header (Home, How it works, Sign in) and the survivor card style.

## Accessibility and usability failures

axe-core found **100 violations** across 10 rules:

| Rule | Impact | Pages |
|---|---|---|
| color-contrast (muted 11 to 12 px text, status chips) | serious | 25 |
| link-name (icon-only account link on phones) | serious | 19 |
| scrollable-region-focusable (chat, console, police lists) | serious | 17 |
| aria-progressbar-name (graph progress) | serious | 13 |
| aria-prohibited-attr (aria-label on plain divs) | serious | 8 |
| definition-list / dlitem (police detail, About numbers) | serious | 4 each |
| heading-order, page-has-heading-one | moderate | 4 each |
| select-name (Setup country/language) | critical | 2 |

Found by looking:

- **The danger question is a small chat bubble.** The Yes/No buttons sit at the top of the screen, out of thumb reach on a
  phone, followed by a long explanation box.
- **The emergency screen does not say who was alerted, on which channel, or when.** On a phone the map takes most of the
  screen, "I'm safe" needs a scroll, and the step indicator overflows the width ("4 Safe" is cut off).
- "Not set up" channels have the same weight as working ones, so three greyed rows outweigh the one that worked.
- Several buttons are 34 px tall (Setup, Copy, Revise, Cancel escalation); the minimum should be 48 px for this audience.
- Status changes (alert sent, location updated, safe) are not announced. The whole chat log is `aria-live`, which would
  read every message aloud instead.
- No skip link, no visible landmark structure on the police page, no `h1` on Home or Police.
- The police table formats dates in the US style, shows raw values ("street/public"), cannot be sorted, and the detail
  panel shows a blank box until a row is clicked.
- The emergency screen loads a Google Maps iframe automatically: a third-party request with tracking, on the one screen
  where a survivor least needs it.
- Noto Nastaliq Urdu loads on every page whether or not Urdu is used.
- The live workflow graph on phones is the desktop graph squeezed into a panel.

## The five changes that matter most

1. **Make the danger question the screen.** Large question, Yes and No as full-width buttons in the thumb zone. Rebuild the
   emergency screen around one status sentence ("Amma was alerted by text 2 min ago"), a channel list where "Not set up"
   is quiet, a sticky "I'm safe" button, and call/text fallbacks.
2. **One token system and one accent.** Red only for danger, a quiet green only for safe/confirmed, near-black ink for
   ordinary primary actions. A real type pairing with an Urdu face, one radius scale, borders instead of nested cards.
3. **Privacy in the interface.** No automatic third-party map (show address and coordinates, load the map only on request),
   a discreet tab title option, quick exit that replaces history and works from the keyboard, and polite status
   announcements instead of a chatty live log.
4. **Draft cards that explain the privacy model.** Who sees each version, what was scanned and found, what happens next,
   and a deliberate two-step Send.
5. **A police register of its own.** A dense, sortable case queue with urgency states on the 24-hour clock, a case-file
   detail view, and its own header. On phones, the live workflow becomes a stacked timeline instead of a shrunken graph.

## After the redesign

Re-captured every state at 360, 390, 768 and 1440 px (`docs/ui-shots/after/`, git-ignored).

- axe-core: **0 violations** on every page and state at every width (was 100).
- No horizontal scroll at 360 px; survivor actions are 48 px or taller and sit in the bottom thumb zone.
- Urdu: right-to-left composer and messages, Nastaliq at 2.1 line height, no layout break with mixed scripts.
- Reduced motion disables all animation; dark mode checked on every survivor screen.
- `scripts/e2e.py` passes in dry-run mode, and the README demo script passes end to end in the browser with no
  page errors.
