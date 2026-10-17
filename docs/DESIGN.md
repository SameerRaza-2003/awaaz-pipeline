# Awaaz design direction

## Mood

Steady, quiet, direct. Warm paper and ink, like a well-made printed leaflet from an organisation you can trust. The
interface speaks in short plain sentences and never raises its voice except for danger.

It should **not** feel like: a wellness app (pastels, soft illustrations, affirmations), a startup landing page
(gradients, glow, feature grids), a corporate dashboard (cold blue, dense chrome), or anything cute.

Two registers, one family:

- **Survivor side:** large type, generous space, one decision per screen, thumb-reachable actions.
- **Police side:** the same tokens at a smaller step, tabular, dense, neutral. A working tool.

## Typography

| Role | Face | Why |
|---|---|---|
| Headings | Newsreader (variable, optical sizes) | Editorial and warm; reads as serious and human, not corporate |
| Body and UI | Atkinson Hyperlegible Next | Built by the Braille Institute for legibility; distinct letterforms help a stressed reader on a small screen |
| Data, tool calls, references | Atkinson Hyperlegible Mono | Same family as the body, so instrumentation looks related, not bolted on |
| Urdu | Noto Nastaliq Urdu | The script people expect; line height 2.1 because Nastaliq stacks diagonally |

All fonts are self-hosted through `next/font` (no request to Google from the survivor's phone), `font-display: swap`.
Only Atkinson Hyperlegible Next is preloaded; Nastaliq downloads only when Urdu text is on screen.

Scale (rem, 16 px root):

| Token | Size | Use |
|---|---|---|
| `--text-caption` | 0.8125 (13 px) | smallest allowed; metadata only |
| `--text-small` | 0.9375 (15 px) | secondary text |
| `--text-body` | 1.0625 (17 px) | survivor body |
| `--text-lead` | 1.25 (20 px) | emphasised body, status sentence |
| `--text-title` | 1.5 (24 px) | section titles |
| `--text-display` | 2 (32 px) | screen question |
| `--text-hero` | 2.5 (40 px) | the danger question on larger screens |

Police uses `--text-small` as body and `--text-caption` for table metadata. Line height 1.55 for Latin text, 2.1 for
Urdu. Weights: 400 body, 600 labels, 600 to 700 headings. Figures in timers and tables are tabular.

## Colour

One accent is reserved for danger. Ordinary primary actions are ink, not colour.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#F6F3EC` | `#131110` | page background |
| `--surface` | `#FFFDF9` | `#1B1916` | raised areas (sheets, inputs, table) |
| `--sunken` | `#EEEAE1` | `#24211D` | wells, code, quiet fills |
| `--ink` | `#1F1B16` | `#EFEAE2` | text, primary buttons |
| `--ink-2` | `#474037` | `#D2CABD` | secondary text |
| `--muted` | `#655D52` | `#A59D90` | metadata (5.4:1 or better everywhere) |
| `--line` | `#DED7CA` | `#302C27` | dividers |
| `--line-strong` | `#8F8576` | `#776F63` | input and control borders (3:1 or better) |
| `--danger` | `#A3231A` | `#A3231A` | emergency actions only; white text 7.5:1 |
| `--danger-ink` | `#8C1D14` | `#FFA195` | danger text |
| `--danger-soft` | `#F8E6E2` | `#3A1A16` | danger backgrounds |
| `--safe` | `#25593F` | `#25593F` | "I'm safe", confirmed; white text 8.1:1 |
| `--safe-ink` | `#255A40` | `#8FD2AC` | confirmed text |
| `--safe-soft` | `#E3EEE7` | `#16291F` | confirmed backgrounds |
| `--hold` | `#7F4E00` | `#E9B65E` | waiting, on hold, deadline near |
| `--hold-soft` | `#F6EAD3` | `#30250F` | |
| `--info` | `#2C5682` | `#8DB4E8` | running (instrumentation only), focus ring |
| `--info-soft` | `#E4ECF5` | `#18233A` | |

Rules: never use red for decoration or for non-emergency actions. Every coloured state also has an icon or a word.
Dark mode is designed separately (warm near-black, lighter tonal text colours), not inverted.

## Space, shape, depth

- Spacing: 4 px base (Tailwind scale). Rhythm tiers 8 / 16 / 24 / 40 / 64.
- Radius: `--radius-sm` 6 px (chips, tags), `--radius` 10 px (buttons, inputs, panels), `--radius-lg` 16 px (sheets).
  Pills only for status chips.
- Depth: borders and dividers, not shadows. One shadow token, `--shadow-overlay`, for the drawer and sheets only.
- Prefer one surface with dividers over cards inside cards.
- Z-index: `--z-sticky` 10, `--z-header` 20, `--z-overlay` 40, `--z-toast` 50.
- Touch targets: 48 px minimum on survivor screens, 40 px on police screens (pointer use).

## Icons

Lucide only, outline, stroke 1.75, sizes 16 / 20 / 24 (`--icon-sm/md/lg`). Icons beside text are `aria-hidden`.
No emoji anywhere.

## Motion

Only to communicate a state change: alert sending, location pinging, agent running, panel opening. Durations 150 / 200
/ 250 ms (`--dur-fast`, `--dur`, `--dur-slow`), ease-out `cubic-bezier(0.2, 0, 0, 1)`. No springs, no bounce, no scroll
reveals, no hover scaling. Everything is disabled under `prefers-reduced-motion`.

## Copy

Short, specific, second person, no exclamation marks, no em-dashes, no "empower / seamless / journey" language. Say what
happened and what happens next. Example: "Amma was alerted by text 2 min ago."
