# Dice Roll Statistics Tracker — Implementation Plan

## 1) File structure and architecture

Keep it intentionally small:

- `index.html` — single-page shell, layout, controls, chart containers
- `styles.css` — all styling, responsive layout, dark-mode support, dice face visuals, animations
- `app.js` — app state, event handling, statistics calculations, Chart.js wiring, localStorage persistence

Architecture choice:

- Use a single-page vanilla JS app with a small internal module/class structure inside `app.js`.
- No backend, no build step, no external API calls.
- Keep all app state in one in-memory object and mirror the persisted portion to `localStorage`.
- Use Chart.js from CDN for the distribution graph.

Recommended internal JS pieces:

- `DiceApp` — bootstraps the app, binds DOM, coordinates mode changes and roll input.
- `StateStore` — owns current session data + persistence load/save/reset.
- `StatsCalculator` — computes frequency, mean, median, std dev, chi-squared, mode/min/max, combo stats.
- `ChartManager` — creates/updates/destroys the Chart.js bar chart.
- `DiceRenderer` — renders face buttons for the current die size and visual feedback.

## 2) HTML structure

Build one semantic page with clear sections:

- Header
  - App title
  - Short subtitle / status line
  - Reset button
- Controls section
  - Mode toggle: `Single` / `Multi`
  - Die type selector: `D4`, `D6`, `D8`, `D10`, `D12`, `D20`, `Custom`
  - Custom sides input shown only when `Custom` is selected
  - Multi-roll controls:
    - dice count selector (minimum 2)
    - tracking option toggle: `Individual` / `Sum`
- Dice input section
  - A grid of tappable face buttons for values `1..N`
  - Each button shows either pips (for D6) or numeral + optional mini-label
  - Visual feedback on tap (pressed/selected/flash)
- Results / stats dashboard
  - Total rolls
  - Most common number
  - Least common number
  - Mean, median, standard deviation
  - Chi-squared score
  - For multi-roll: sum stats + combination frequency summary
- Chart section
  - Bar chart canvas
- Session log / recent rolls section
  - Compact list of last N rolls for quick verification

Use accessible semantics:

- Buttons for all interactive controls
- `aria-pressed` for toggle states
- Labels tied to inputs
- A live region for “roll recorded” feedback if needed

## 3) CSS approach

Goals:

- Clean, modern, dark-mode friendly
- Large touch targets for mobile
- Responsive from narrow phones to desktop
- Clear visual hierarchy

Layout approach:

- Use CSS variables for colors, spacing, radius, shadows, and transitions.
- Use a centered container with max width.
- Use CSS Grid for the dashboard and dice grid.
- Collapse to one-column layout on mobile; use two-column dashboard on wider screens.

Dark mode:

- Default to dark-friendly palette.
- Respect `prefers-color-scheme` and provide explicit theme variables.
- Keep chart and card surfaces high-contrast but soft.

Dice face visuals:

- D6 faces rendered with CSS pip layouts.
- Other die faces can use large numerals with a subtle face card style.
- Buttons should be at least ~44px tall on mobile.

Animation:

- Add a brief pressed/flash state on roll recording.
- Use a tiny scale/opacity transition for tactile feedback.
- Keep animation short so it feels responsive, not flashy.

Responsive details:

- Dice grid should wrap nicely and stay finger-friendly.
- Stat cards stack vertically on small screens.
- Chart should be responsive and keep readable labels.

## 4) JavaScript architecture

Use plain ES6+ JavaScript.

Core state shape:

- `mode`: `single` | `multi`
- `dieSides`: number
- `diceCount`: number
- `trackingMode`: `individual` | `sum`
- `rolls`: array of recorded roll objects
- `recentRolls`: derived from `rolls`
- `lastUpdated`: timestamp

Main flow:

1. User selects die type / mode / tracking option.
2. App renders the correct input grid.
3. User taps a face button.
4. App records the roll object, persists state, recalculates stats, updates chart and dashboard, and flashes the button.

Event handling:

- Use event delegation on the dice grid.
- Use change handlers for mode and die selectors.
- Use a single reset handler with confirmation if the session has data.
- Re-render only the parts that changed where practical.

Suggested helpers:

- `generateRollId()`
- `rollToLabel()`
- `validateCustomSides()`
- `buildFaceGrid()`
- `formatNumber()`
- `roundForDisplay()`

## 5) Data model

Store each roll as a structured object, not just a number.

### Single-roll record

```js
{
  id,
  timestamp,
  mode: 'single',
  dieSides: 6,
  value: 4
}
```

### Multi-roll record: individual tracking

```js
{
  id,
  timestamp,
  mode: 'multi',
  dieSides: 6,
  diceCount: 2,
  trackingMode: 'individual',
  values: [3, 5]
}
```

### Multi-roll record: sum tracking

```js
{
  id,
  timestamp,
  mode: 'multi',
  dieSides: 6,
  diceCount: 2,
  trackingMode: 'sum',
  values: [3, 5],
  sum: 8,
  comboKey: '3+5'
}
```

Persistence:

- Save the entire session object to `localStorage`.
- Include versioning, e.g. `{ version: 1, settings: ..., rolls: ... }`.
- On load, migrate or discard invalid legacy data gracefully.

Data rules:

- Treat custom sides as positive integers.
- In multi mode, ensure dice count is at least 2.
- Preserve raw values so later stat changes do not lose information.

## 6) Chart.js integration details

Use a single Chart.js bar chart for frequency distribution.

Chart behavior:

- Labels: face values from `1..dieSides`
- Dataset: observed frequency per face
- Responsive sizing enabled
- Disable heavy animations or keep them minimal
- Tooltip shows count and percentage of total rolls

Update strategy:

- Build chart once after DOM ready.
- Call `chart.update()` whenever rolls or die size changes.
- Recreate chart only when the axis domain changes materially (e.g. die size switch) if needed.

Chart modes:

- Single mode: frequency of face values
- Multi individual: either aggregate all individual dice values or show per-die summary depending on selected dashboard mode
- Multi sum tracking: separate sum distribution chart if desired, or switch chart dataset to sums while keeping combination stats below

Recommended implementation:

- Keep the primary chart as the observed face/sum distribution for the active view.
- Show combo frequency in a text list or secondary compact table to avoid overcrowding.

## 7) Statistical calculations

Compute stats from the active dataset.

### Basic stats

- `totalRolls`
- frequency map
- most common value(s)
- least common value(s)
- mean
- median
- standard deviation (sample or population; choose population and document it)

### Chi-squared test

For the current die type and active dataset:

- Expected count per face = `totalObservations / dieSides`
- Statistic = `Σ((observed - expected)^2 / expected)` across all faces
- Degrees of freedom = `dieSides - 1`

Display:

- chi-squared statistic
- degrees of freedom
- optional plain-language hint like “lower is closer to uniform”

Important nuance:

- For multi-roll sum tracking, chi-squared on sums is not uniform over outcomes, so only compute the uniform-face chi-squared when the active observation set is faces from a fair die. If the app is in sum mode, either:
  - compute chi-squared only for the raw face values, or
  - label the sum chi-squared as exploratory only.

### Multi-roll extras

- Combination frequency map keyed by sorted combo string (`3+5` == `5+3` if order should not matter)
- Sum distribution frequency
- Optional per-die position stats when in individual mode

Edge cases:

- No rolls yet: show dashes / empty states.
- Single roll only: standard deviation = 0.
- Multiple modes with different die sizes should either reset the session or be clearly separated; simplest is to reset or require the die type to remain fixed for a session.

## 8) Implementation order

Build in this order to reduce rework:

1. Scaffold the static page structure in `index.html`.
2. Add base layout and theme tokens in `styles.css`.
3. Render the dice face grid and basic input controls.
4. Implement in-memory state + localStorage load/save.
5. Add single-roll recording end to end.
6. Add stats calculations for basic frequency, mean, median, std dev, most/least common.
7. Integrate Chart.js and render the frequency bar chart.
8. Add reset/session clear behavior.
9. Add multi-roll mode with individual tracking.
10. Add multi-roll sum tracking + combo frequency summaries.
11. Add chi-squared calculations and display.
12. Polish responsive behavior, accessibility, and tap animations.
13. Add validation, error states, and empty-state UX.
14. Do final testing across mobile and desktop widths.

## 9) Testing approach

Since this is a static app, test with a mix of manual checks and lightweight automated checks if desired.

Manual test matrix:

- Single D6 roll recording
- Different die sizes: D4, D8, D10, D12, D20, custom
- Multi-roll individual mode
- Multi-roll sum mode
- Reset clears all state and localStorage
- Reload restores saved session correctly
- Responsive layout at mobile and desktop widths
- Dark mode readability
- Chart updates correctly after each roll
- Stats update correctly when rolls are added

Validation checks:

- No invalid custom die sizes accepted
- Buttons remain usable on touch devices
- No chart errors when there are zero rolls
- No NaN values in stats display

Optional automated checks:

- Use a small browser test harness or manual console assertions if no build tool is used.
- Add pure JS unit tests later only if the app grows; keep the first version dependency-free.

## Done criteria

The app is done when:

- Users can record rolls by tapping visual faces
- Single and multi-roll modes both work
- Stats and chart update live
- Session persists in `localStorage`
- Reset works cleanly
- Layout is usable on mobile and desktop
- The code stays simple enough to host directly on GitHub Pages
