# MIRRA AI — Video Demo Runbook

## Prerequisites

- Node.js 18+ and Python 3.11+
- Backend venv with requirements installed (`backend\venv`)
- Frontend packages installed (`cd frontend && npm install`)
- `frontend/.env.local` points at the backend:
  `NEXT_PUBLIC_API_BASE_URL=http://localhost:8001` and `NEXT_PUBLIC_API_URL=http://localhost:8001`

## Start the backend (from the repo root)

```bash
backend\venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8001
```

Check it with `curl http://localhost:8001/api/health`, which should return `"status":"healthy"`.

> Restart the backend before recording. Human reviews (Modify / Reject) add learned precedents to the
> policy knowledge base, both in memory and in `backend/policy/policy_knowledge_base.json`. A restart
> plus a clean copy of that file gives every take the same starting point.

## Start the frontend

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`. For recording, prefer `npm run build && npm run start`, so the dev badge does not appear in the video.

## Navigation

Every page except the review and internal console pages has the global nav:
**MIRRA AI · Home · Team · How MIRRA Works · Demo · Ryde Experience · English | 中文**.
**Presenter Mode** also appears on `/demo…` pages.

Route flow:
- `/demo`: Choose Demo.
- `/demo/N`: the briefing page. It covers the scenario, what the demo proves and the expected outcome, and has four actions:
  - **Begin Guided Demo**
  - **Passenger App ↗**
  - **Driver App ↗**
  - **Internal Console ↗**
- The briefing creates one session id (e.g. `demo3-x1y2z`) and every action uses it. **Start fresh session** issues a new one.
- `/demo/N/passenger?session=…` and `/demo/N/driver?session=…` are standalone party tabs. Each has **Back to Demo**, the session id, a language switch, **Open Driver / Passenger App ↗** (same session) and **Reset Session**.
- **Internal Console:**
  - LIVE case: opens the real case.
  - LIVE mode before a complaint: disabled ("Available after formal complaint").
  - DEMO MODE: opens the fixture observer view.
- `/experience`: Passenger Experience / Driver Experience. Each scenario opens the realistic party app; both sides of a scenario share one experience session.

## Guided Demo controls

The global nav stays on top. Below it sit **Back to briefing**, the title, theme and LIVE/DEMO badge, then the demo controls:

| Control | Purpose |
|---|---|
| **Passenger App ↗ / Driver App ↗ / Internal Console ↗** | Open the same session in its own tab |
| **Backend: LIVE / DEMO MODE** | LIVE creates a real backend case and streams the real tribunal. DEMO MODE uses deterministic fixtures, the offline fallback. |
| **Reset** | Clears this demo session only. Language and mode settings survive. |
| **Presenter Mode** (global nav) | Shows the dark presenter guide: say, watch, proves, expected (reference plus authoritative backend outcome) and next |
| **English \| 中文** (global nav) | Switches language only; all session and review state is kept |

The progress stepper reads: Trip → Private Assistance → Formal Complaint → Tribunal → Decision.
Demo 3 adds Evidence / Verification and Human Review.

## Demo 1 — Route Deviation (Automation)

**Theme:** MIRRA can automate a clear, low-risk dispute when verified evidence supports the outcome.

1. Open `/demo/1` (briefing), then **Begin Guided Demo** (or open `/demo/1/guided?session=demo-1` directly).
2. **Trip:** Both phones show Marina Bay Sands → Changi Airport T3, fare S$18.50.
3. **Passenger phone:** Tap the **MIRRA AI** pill in the Ryde app bar. The passenger asks about the longer route.
4. Tap **View route comparison**. MIRRA privately shows 35 min actual against 28 min estimated, a 2.3 km deviation onto PIE, and the S$18.50 fare.
5. Tap **Submit formal complaint**. MIRRA explains the boundary: the complaint is shared with the driver and Ryde, but the private chat is not.
6. Tap **Proceed with complaint**. The complaint form opens directly, with no Back press needed.
7. Type the complaint and tap **File Formal Complaint**. The driver phone shows "Dispute received", but never the passenger's private chat.
8. **Start Tribunal.** In LIVE mode the case is created automatically; only one case is created even with two tabs open.
9. The **Tribunal Board** runs in this order:
   - Rider Advocate → Driver Advocate → Initial Prosecutor → Cross-examination.
   - The party's answer to cross-examination is labelled **CLAIM · not verified**.
   - Then Final Prosecutor → Policy Consultant → AI Judge → **Execution Router (always last)**.
10. **Decision:** A S$3.25 partial refund, executed automatically. Both phones show the result at the top.

Expected LIVE result: partial refund S$3.25, automated route (verified on DISP-034).

## Demo 2 — No-show Charge (Fairness)

**Theme:** MIRRA does not automatically side with the complainant.

1. Open `/demo/2`, then **Begin Guided Demo**. The trip is Tiong Bahru Plaza → VivoCity, with a S$5 no-show fee.
2. **Passenger phone:** Open **MIRRA AI**, then tap **Check waiting timeline**:
   - 08:43 driver arrival
   - 08:43:05 rider notified
   - 08:43:10 timer started
   - 08:47:05 driver called
   - 08:48:10 free waiting period ended
   - 08:51 cancelled
3. Tap **Submit formal complaint** → **Proceed with complaint**, fill in the form, then **File Formal Complaint**.
4. **Start Tribunal.** The evidence confirms the driver followed procedure. The rider's answer stays a CLAIM.
5. **Decision:** No refund; the fee is valid. Executed automatically.

Expected LIVE result: no refund, automated route (verified on DISP-033).

## Demo 3 — Cleaning Fee (Responsible AI)

**Theme:** MIRRA knows when evidence is insufficient or suspicious, and hands the decision to a human.

1. Open `/demo/3`, then **Begin Guided Demo**. The Driver App ↗ tab can also be used for the claim. The trip is Orchard → Bishan, fare S$24.50.
2. **Driver phone:** Tap **MIRRA AI**. The driver reports the mess and MIRRA explains the evidence requirements.
3. Tap **Start cleaning-fee claim**. **Evidence Intake** opens directly.
4. Upload a photo and a receipt, then tap **Submit Claim**. This files the S$60 cleaning-fee claim.
   - **Continue without evidence** is also available.
5. **Start Tribunal.** Evidence is now frozen at state level: no add, replace, remove or clear is possible from any tab.
6. **Tribunal:**
   - The photo shows an EXIF mismatch and reuse risk; the receipt is valid at S$60.
   - The driver's explanation is a CLAIM.
   - The Execution Router stops automation.
7. The Guided Demo shows **HUMAN REVIEW REQUIRED** ("No cleaning fee is charged and no driver payout happens until a human reviewer decides"). Both phones show "Under human review".
8. Click **Open Human Review →**:
   - **LIVE:** opens `/review/<caseId>?demo=3&session=…`, the real review page. You must be signed in as a **Support** account.
   - **DEMO MODE:** opens `/review/DEMO-REVIEW-<session>`, an offline demo reference labelled **DEMO MODE · not a live case**. It needs no login or backend.
9. **HUMAN REVIEW DECISION** section:
   - **Confirm AI recommendation → Approve S$60 Cleaning Fee.**
   - **Modify decision:** enter the final SGD amount (a number, 0 or more), e.g. S$40.
   - **Reject recommendation → Reject Cleaning Fee Claim.**
10. What happens after the click:
    - **Confirm / Modify:**
      1. `POST /api/disputes/{caseId}/human-review` runs first.
      2. Only after it succeeds, one simulated payment runs: `POST /api/mock-ryde-pay/cleaning-fee` with the **human-final amount**.
      3. The page shows **Simulated Ryde Payment** and the **Demo Transaction ID**.
    - **Reject:**
      1. The review is submitted.
      2. The payment endpoint is **never called**. The page shows "Claim rejected · No cleaning fee charged · No driver payout".
      3. The payment state becomes `not_required`.
11. Click **Back to Guided Demo**. Both phones and the presenter view show the same final decision:
    - **Approved / modified:** "A S$XX cleaning fee was approved after human review." (both parties)
    - **Rejected:** the passenger sees "No cleaning fee will be charged." and the driver sees "Your cleaning fee claim was not approved."

Expected LIVE result: human review route, with no payment before the review (verified on DISP-030/031/032).

## Payment safety

- Payment states are `idle → pending → completed | failed`, or `not_required` (rejected, or S$0). Rejection is never shown as `completed`.
- One payment per reviewed decision. A per-case ledger with an execution lock blocks double clicks, re-renders, refreshes and second tabs. If a transaction ID exists, the endpoint is not called again.
- If a tab closes mid-payment, the lock expires after 20 s and another tab resumes the payment.
- A failed simulated payment keeps the review decision and offers **Retry payment**.
- If the case was already reviewed elsewhere (HTTP 409), the page records the decision the backend holds and does not pay on top of it.

## Internal Console

**URL:** `/internal/<caseId>`. It is labelled **MIRRA Internal Console** and is a demo observer view, not visible to the rider or driver.

Tabs: Overview, Evidence, Agent Logs, Policy, Decision, Learnings. It never shows private MIRRA message text.

## Human Review Queue

**URL:** `/review` (Support login).

- The stat strip shows **Open**, **High priority**, **SLA risk** (including past SLA) and **Reviewed**.
- Cleaning-fee cases open with the Human Review Decision section at the top.

## Fallback: backend unavailable

1. In the Guided Demo, click **Switch to Demo Mode** (or use the header toggle).
2. Demo Mode uses deterministic fixtures:
   - Demo 1: partial refund of S$3.25.
   - Demo 2: no refund.
   - Demo 3: human review via the offline demo reference.
3. If a LIVE page is reloaded after the tribunal finished, the tribunal is restored from the stored backend result without re-running the pipeline. If it was reloaded mid-stream, **Retry** re-runs it.

## Key checkpoints

| Checkpoint | Expected |
|-----------|----------|
| Private chat isolation | Driver never sees the passenger's MIRRA chat, and vice versa |
| Complaint boundary | Submit formal complaint → boundary explained → Proceed → form opens |
| Cross-tab sync | Two tabs of the same session update in real time |
| No duplicate cases | One liveCaseId per session, even with two tabs |
| Evidence freeze | After the tribunal starts, evidence cannot change from any tab |
| Incomplete Judge | "Judge result incomplete", never "No refund"; missing confidence shows "unavailable", not 0% |
| Cleaning Fee safety | No payment before a successful human review; Reject never pays |
| Bilingual | EN / 中文 switch keeps all state |
| Reset | Clears only the current demo session |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Review page redirects to `/login` | Sign in with a Support account (the review system is Support-only) |
| Backend connection refused | Check uvicorn is running on port 8001 |
| SSE stops | Click **Retry**, or switch to Demo Mode |
| Payment simulation failed | Check `/api/mock-ryde-pay/cleaning-fee`, then use **Retry payment** on the review page |
| Live Demo 3 Judge mentions a filing window | The Demo 3 trip in backend mock data is dated 2026-09-25, so the Judge may cite late filing; the case still routes to human review |
