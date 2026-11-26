# Sales video: editor handoff (60–75 s landscape, 30 s vertical)

Status 26 Nov 2026: **footage not yet recorded.** The staging app could not be reached from the build sandbox, so no real screen recording exists yet. Nothing in this folder is a staging recording. Record with the steps below once the demo is deployed (docs/demo/PROSPECT_DEMO.md §5), then cut to this plan.

Ready in this folder:

| File | What |
|---|---|
| `landscape-72s.en.srt`, `landscape-72s.fr.srt` | Captions timed to the landscape cut below |
| `vertical-30s.en.srt`, `vertical-30s.fr.srt` | Captions timed to the vertical cut below |
| `thumbnail.png` (1280×720), `thumbnail.html` (source) | Sales thumbnail in the DLang Sports OS demo style |

## 1. Recording the footage (real staging, fictional records)

1. Deploy the branch to staging and run the checks in PROSPECT_DEMO.md §4.
2. Automated capture (also re-checks the journey):
   `DEMO_E2E=1 E2E_BASE_URL=https://dlang-staging.vercel.app npx playwright test e2e/demo --project=chromium-desktop`
   Each test writes a 1440×900 `.webm` to `test-results/`. Use them as the base, or as a guide for a manual take.
3. Manual take (recommended for the final cut): Chrome at 1440×900, 100% zoom, a fresh browser profile, cookie banner closed ("Necessary only"), OS notifications off. Turn on click highlighting in the recorder (visible taps). For the phone shots use Chrome device mode "iPhone 13" or a real phone recording.
4. Before each take, press **Reset demo** on `/demo` so Alex starts unregistered.
5. Never show the browser address bar with a session link, the demo cookie, devtools or any login e-mail. The demo uses no passwords, so none can appear.

Shots to capture (hold each end state 2–3 s):

| # | Role (button on /demo) | Screen | Action |
|---|---|---|---|
| A | Start as Jamie | `/parent/home` | Athlete switcher: tap Sam, then Alex |
| B | Jamie | `/parent/club-programmes` | U14 Falcons → choose Alex → **Send request** → request shows pending |
| C | Start as Club Admin | `/admin/approvals` | Alex Morgan · U14 Falcons → **Confirm** → "Confirmed and enrolled." |
| D | Start as Coach Taylor | `/coach/team` | U14 Falcons roster, Alex Morgan visible (zoom on the row) |
| E | Coach Taylor | `/coach/trainings` → today's practice → attendance | Alex → **Present**, **Mark all present**, **Review and finalize** → **Finalize** |
| F | Start as Jamie | `/parent/camps` → Skills Camp | Book Sam, 5 days → lands on the invoice |
| G | Start as Finance | `/admin/invoices` | Open Jamie's camp invoice; then Casey Brooks's paid camp invoice (sandbox card payment, same reference) |
| H | Start as Alex | `/player`, `/player/attendance` | Schedule; today's practice marked Present |
| I | – | `/demo` | Five role cards, then "Book a walkthrough" |

The digital membership card is **not** in the cut: it is not set up in the demo scenario and was not verified.

## 2. Landscape cut (1920×1080, 30 fps, 72 s)

Style (from the current 40 s demo): near-black to maroon radial background with faint court circles, red "D" tile + "DLang Sports OS" top left, bold white headline per section, framed app window with "Product preview" label and a thin red progress bar with "n/5" counter at the bottom. Close crops (150–200% on the active area), visible tap ripples, low music (around −24 LUFS under voice, ducked), conversational English voice.

| Time | Picture | Voiceover | On-screen headline |
|---|---|---|---|
| 0:00–0:06 | Shot B start: Alex's registration (programme card, Alex selected) | "How many places does your staff have to update when one athlete joins?" | One athlete joins. |
| 0:06–0:18 | Shot A (switch Sam → Alex), then B (Send request → pending) | "With DLang Sports OS, parents can manage both children from one account and see where each registration stands." | One family account. · 1/5 |
| 0:18–0:32 | C (Confirm → "Confirmed and enrolled.", hold 2 s) **hard cut** to D (Alex on the U14 Falcons roster, hold 3 s), then E (Present → Finalize) | "Once Alex is approved, Coach Taylor can see Alex on the team roster and take attendance from the gym." | Approved once. On the roster. · 2/5 |
| 0:32–0:48 | F (book Skills Camp → invoice) cut to G (Finance opens the matching invoice, hold 3 s on number + status; then Casey's paid invoice) | "When families book a programme, staff can follow the booking, invoice and payment from the same workflow." | Booking, invoice, payment. · 3/5 |
| 0:48–1:00 | H (schedule, attendance "Present") | "Athletes and families can find what they need before practice." | Ready before practice. · 4/5 |
| 1:00–1:12 | I (five role cards), end card "Try the demo" + "Book a walkthrough" | "Run a club or academy? Try DLang Sports OS from your team's perspective. Then book a walkthrough for your organisation." | Try the demo. · 5/5 |

Keep "Alex Morgan" readable in C, D, E and H (the same name in every view). No claim about time saved or revenue: no measured pilot evidence exists yet.

## 3. Vertical cut (1080×1920, 30 fps, 30 s)

Reframe each shot to the active area (roughly a 9:16 crop around the card / row being tapped), captions in the lower third above the safe zone, headline top third.

| Time | Picture | Voiceover / caption |
|---|---|---|
| 0:00–0:04 | B start (registration card) | "One athlete joins. How many places do you update?" |
| 0:04–0:10 | B (Send request → pending) | "Parents register each child from one account." |
| 0:10–0:16 | C (Confirm → confirmed) | "Once Alex is approved," |
| 0:16–0:22 | D (Alex on the U14 Falcons roster, zoomed) | "Coach Taylor sees Alex on the roster. No re-entry." |
| 0:22–0:26 | G (matching invoice, status) | "The booking, invoice and payment stay connected." |
| 0:26–0:30 | End card "Try the demo" | "Run a club or academy? Try the demo." |

## 4. Export

- Landscape: H.264 High, 1920×1080, 30 fps, 12–16 Mbit/s, AAC 48 kHz stereo, `dlang-sports-os-demo-72s.mp4`.
- Vertical: H.264 High, 1080×1920, 30 fps, 10–12 Mbit/s, `dlang-sports-os-demo-30s-vertical.mp4`.
- Deliver the SRTs as sidecar files; burn in English captions on the vertical cut only if the channel needs it.
- Re-time the SRTs if the final cut differs by more than 0.2 s from the tables above.
