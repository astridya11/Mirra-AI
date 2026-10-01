# Ryde — AI Tribunal Frontend

A sleek, iOS-native Ryde mobile app simulator with AI-powered multi-agent dispute resolution tribunal. Built with Next.js (App Router), TypeScript, and Tailwind CSS.

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:3000
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Backend API base URL |
| `NEXT_PUBLIC_USE_MOCK` | `false` | When `true`, uses mock data instead of real API calls |

### Real Test

```bash
cd backend
(Windows) .\venv\Scripts\Activate.ps1 / (MacOS/Linux) source venv/bin/activate
uvicorn backend.main:app --reload --port 8000
```

### Mock Mode

```bash
NEXT_PUBLIC_USE_MOCK=true npm run dev
```

Mock mode emulates the SSE pipeline stream (1.2s delay between events) and serves mock case data for DISP-001, DISP-002, DISP-003.

## App Flow & Screens

| Route | Screen | Description |
|-------|--------|-------------|
| `/` | Home / Booking | Simulated Ryde map with bottom booking card, hamburger menu |
| `/help` | RydeHELP | Search bar + topics list (Popular, Ryde+, Safety, etc.) |
| `/help/topic/[topicId]` | Topic Issues | Sub-issues list per topic (e.g., Ryde Experience) |
| `/help/select-trip` | Select Trip | Recent trips (past 30 days) for issue association |
| `/help/chat` | Support Chat | AI support chat → dispute logging → tribunal launch |
| `/tribunal/[caseId]` | AI Tribunal | Live SSE multi-agent deliberation stream |
| `/verdict/[caseId]` | Verdict | Ruling, settlement breakdown, cited policies, accept/escalate |
| `/review/[caseId]` | Human Review | Escalation dashboard for support agents |

## Design System

- **Primary Accent**: Ryde Pink `#E84360` (buttons, active states, links)
- **Backgrounds**: Pure white `#FFFFFF`, light gray `#F9FAFB`
- **Text**: Primary `#111827`, Secondary `#6B7280`, Tertiary `#9CA3AF`
- **Dividers**: Thin `border-gray-100` (`#E5E7EB`)
- **No heavy shadows** — subtle `0 1px 2px rgba(0,0,0,0.05)` max
- **Typography**: Inter / -apple-system, iOS HIG spacing
- **Party Colors**: Rider `#E84360`, Driver `#0D9488`, Prosecutor `#D97706`, Judge `#1E293B`

## SSE Integration

The tribunal page connects to `GET /api/disputes/{id}/stream` (EventSource):

- `pipeline_event`: Agent conversation events (statements, questions, responses) + phase milestones
- `pipeline_complete`: Final case result with `judge_verdict`

## API Endpoints

| Endpoint | Method |
|----------|--------|
| `/api/disputes` | GET |
| `/api/disputes/{id}` | GET |
| `/api/disputes/{id}/stream` | GET (SSE) |
| `/api/disputes/{id}/result` | GET |
| `/api/disputes/{id}/human-review` | POST |

## Project Structure

```
frontend/
├── app/
│   ├── layout.tsx                     # Root layout
│   ├── globals.css                    # Design tokens + animations
│   ├── page.tsx                       # / — Ryde Home (map + booking)
│   ├── help/
│   │   ├── page.tsx                   # /help — RydeHELP
│   │   ├── topic/[topicId]/page.tsx   # /help/topic/[id] — Issues
│   │   ├── select-trip/page.tsx       # /help/select-trip — Trip picker
│   │   └── chat/page.tsx              # /help/chat — Support chat
│   ├── tribunal/[caseId]/page.tsx     # /tribunal/[id] — Live stream
│   ├── verdict/[caseId]/page.tsx      # /verdict/[id] — Verdict
│   └── review/[caseId]/page.tsx       # /review/[id] — Human review
├── src/
│   ├── types.ts                       # TS types (backend schemas)
│   ├── lib/api.ts                     # API client + SSE
│   ├── mock/                          # Mock data + stream
│   └── components/
│       ├── Drawer.tsx                 # Side navigation drawer
│       ├── IOSHeader.tsx              # iOS nav bar
│       ├── IOSListItem.tsx            # iOS list row
│       ├── AgentBadge.tsx             # Agent role badge
│       └── TypingDots.tsx             # Typing indicator + live dot
```

## Build

```bash
npm run build
```
