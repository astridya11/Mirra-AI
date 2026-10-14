# MIRRA AI — Video Demo Runbook

## Prerequisites

- Node.js 18+ installed
- Python 3.11+ installed (for backend)
- Backend dependencies installed (`pip install -r backend/requirements.txt`)
- Frontend dependencies installed (`cd frontend && npm install`)

## Start Backend

```bash
cd backend
python -m uvicorn main:app --reload --port 8000
```

Verify: `curl http://localhost:8000/api/health` should return `{"status":"ok"}`.

## Start Frontend

```bash
cd frontend
npm run dev
```

Open: `http://localhost:3000`

## Demo 1 — Route Deviation (Automation)

**Theme:** MIRRA can automate a clear, low-risk dispute when verified evidence supports the outcome.

1. From Showcase (`/`), click **View Demos** → **Demo 1: Route Deviation**
2. Guided page opens: `/demo/1/guided?session=demo-1`
3. **Trip stage:** Both phones show Marina Bay Sands → Changi Airport T3, S$18.50
4. **Private MIRRA (Passenger):** Click MIRRA entry → send "I think the driver took a longer route"
5. MIRRA responds with GPS evidence (35 min actual / 28 min estimated, 2.3 km deviation)
6. Click **Submit formal complaint** → MIRRA explains privacy boundary → click **Proceed with complaint**
7. Complaint form opens automatically → submit
8. **Formal Filed:** Both phones show complaint banner. Driver sees "Dispute received"
9. **Start Tribunal:** Presenter clicks "Start Tribunal"
10. **Tribunal Board:** Shows Rider Advocate → Driver Advocate → Evidence Audit → Policy → Judge → Execution Router
11. **Decision:** Partial refund S$3.25, automated execution
12. **Reset:** Click "Reset Demo" to replay

**Expected LIVE result:** `TRIP-2026-08112`, partial refund, automated route.

## Demo 2 — No-show Charge (Fairness)

**Theme:** MIRRA does not automatically side with the complainant.

1. From Showcase, click **Demo 2: No-show Charge**
2. Guided page: `/demo/2/guided?session=demo-2`
3. **Trip stage:** Tiong Bahru Plaza → VivoCity, S$5.00, cancelled
4. **Private MIRRA (Passenger):** Open chat → "Why was I charged a cancellation fee?"
5. MIRRA reviews timeline: driver arrived 08:43, notified 08:43:05, timer expired 08:48:10, cancelled 08:51
6. Click **Proceed with complaint** → form opens → submit
7. **Formal Filed:** Both phones show banner
8. **Start Tribunal**
9. **Tribunal Board:** Evidence confirms driver followed procedure
10. **Decision:** No refund. Fee is valid.
11. **Reset** to replay

**Expected LIVE result:** `TRIP-2026-09945`, no refund, automated route.

## Demo 3 — Cleaning Fee (Responsible AI)

**Theme:** MIRRA knows when evidence is insufficient/suspicious and when human judgment is required.

1. From Showcase, click **Demo 3: Cleaning Fee**
2. Guided page: `/demo/3/guided?session=demo-3`
3. **Trip stage:** Orchard → Bishan, S$24.50
4. **Private MIRRA (Driver):** Open chat → "The rider left a mess"
5. MIRRA explains evidence requirements: photo + receipt
6. Click **Start Cleaning Fee Claim** → Evidence Intake opens
7. **Evidence Intake:** Upload photo + upload receipt (or skip)
8. Click **Submit Claim** → Formal complaint filed
9. **Formal Filed:** Both phones show banner
10. **Start Tribunal**
11. **Tribunal Board:** Photo shows EXIF mismatch / reuse risk. Receipt valid S$60.
12. **Decision:** Human Review Required
13. **Human Review:** Open `/review` → find the case → click **Review**
14. Reviewer sees: case summary, evidence, fraud assessment
15. Actions:
   - **Approve S$60** → simulated payment runs
   - **Modify Amount** → enter new amount → payment runs with modified amount
   - **Reject Claim** → no payment, claim rejected
16. **Party Result:** Both phones update with final human-reviewed decision
17. **Reset** to replay

**Expected LIVE result:** `TRIP-2026-09104`, human review route, no auto-payment.

## Internal Console

**URL:** `/internal/DISP-xxx` (replace with actual case ID)

**Use during LIVE demos to show:**
- Case metadata
- Evidence tab: Photo verification, Receipt OCR, Prosecutor findings, Fraud assessment
- Agent logs
- Policy consultation
- Decision details

**Do not show in normal party UX.**

## Human Review Queue

**URL:** `/review`

**Use during Demo 3 to show:**
- Open cases
- High priority / SLA at risk
- Reviewed history

Click a case to open detail view with Confirm / Modify / Reject actions.

## Fallback: Backend Unavailable

If backend is down during demo:

1. In Guided Demo, click **Switch to Demo Mode**
2. Demo mode uses deterministic fixtures:
   - Demo 1: partial refund S$3.25
   - Demo 2: no refund
   - Demo 3: human review required
3. All UI flows work identically
4. Tribunal Board shows fixture events instead of live SSE

## Key Checkpoints

| Checkpoint | Expected |
|-----------|----------|
| Private chat isolation | Driver cannot see passenger MIRRA, and vice versa |
| Cross-tab sync | Two tabs same session: state updates in real time |
| No duplicate cases | Same session only creates one liveCaseId |
| Evidence freeze | After tribunal starts, evidence cannot be modified |
| Incomplete Judge | Shows "Judge result incomplete" — never "No refund" |
| Cleaning Fee safety | Never auto-charges. Always requires human review first |
| Bilingual | Language switch preserves all state |
| Reset | Clears only current demo session. Language/presenter survive |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `npm run build` safe-delete error | Retry the command |
| Backend connection refused | Verify uvicorn is running on port 8000 |
| SSE stops | Check backend logs. Click "Retry" in UI or switch to Demo Mode |
| Case creation fails | Check `/api/health`. Clear localStorage and refresh |
| Payment simulation fails | Check backend `/api/mock-ryde-pay/cleaning-fee` endpoint |
| Two tabs create duplicate cases | Verify cross-tab lock: only one tab should claim creation |
