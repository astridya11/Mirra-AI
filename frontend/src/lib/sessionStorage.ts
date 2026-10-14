import type { DemoSession, DemoId, Party, PartyView } from "@/src/types/session";
import { demoScenarios } from "./demoScenarios";

const SESSION_PREFIX = "mirra.demo.v1";
const BC_CHANNEL = "mirra-session-sync";

function storageKey(demoId: DemoId, sessionId: string): string {
  return `${SESSION_PREFIX}.${demoId}.${sessionId}`;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window !== "undefined" && "BroadcastChannel" in window) {
    try {
      return new BroadcastChannel(BC_CHANNEL);
    } catch {
      return null;
    }
  }
  return null;
}

function readSessionRaw(demoId: DemoId, sessionId: string): DemoSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(demoId, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoSession;
    if (!parsed.demoId || !parsed.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionRaw(session: DemoSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(session.demoId, session.sessionId),
      JSON.stringify(session)
    );
  } catch {
    // Storage full or disabled
  }
}

function broadcastUpdate(demoId: DemoId, sessionId: string): void {
  const bc = getBroadcastChannel();
  if (bc) {
    bc.postMessage({
      type: "session-updated",
      demoId,
      sessionId,
      timestamp: Date.now(),
    });
  }
}

function createDefaultSession(demoId: DemoId, sessionId: string): DemoSession {
  const scenario = demoScenarios[demoId];
  return {
    demoId,
    sessionId,
    stage: "none",
    tripStatus: scenario?.initialTripStatus ?? "completed",
    evidenceFrozen: false,
    trip: scenario?.trip ?? {
      pickup: "",
      dropoff: "",
      fare: "",
      eta: "",
      status: "completed",
    },
    passengerChat: {
      messages: [],
      suggestions: [],
      complaintDrafted: false,
    },
    driverChat: {
      messages: [],
      suggestions: [],
      complaintDrafted: false,
    },
    updatedAt: Date.now(),
  };
}

export function getOrCreateSession(demoId: DemoId, sessionId: string): DemoSession {
  const existing = readSessionRaw(demoId, sessionId);
  if (existing) return existing;
  const fresh = createDefaultSession(demoId, sessionId);
  writeSessionRaw(fresh);
  return fresh;
}

export type SessionUpdater = (session: DemoSession) => DemoSession;

/**
 * Atomic session update: re-reads the latest persisted state, applies the
 * updater, writes back, and broadcasts.  This prevents concurrent tabs from
 * silently overwriting each other's shared-state mutations.
 */
export function updateSession(
  demoId: DemoId,
  sessionId: string,
  updater: SessionUpdater
): DemoSession {
  const latest = readSessionRaw(demoId, sessionId) ?? createDefaultSession(demoId, sessionId);
  const mutated = updater(latest);
  const updated: DemoSession = { ...mutated, updatedAt: Date.now() };
  writeSessionRaw(updated);
  broadcastUpdate(demoId, sessionId);
  return updated;
}

export function addChatMessage(
  demoId: DemoId,
  sessionId: string,
  party: Party,
  text: string,
  sender: "user" | "mirra"
): DemoSession {
  return updateSession(demoId, sessionId, (session) => {
    const chatKey = party === "passenger" ? "passengerChat" : "driverChat";
    return {
      ...session,
      [chatKey]: {
        ...session[chatKey],
        messages: [
          ...session[chatKey].messages,
          {
            id: generateId(),
            sender,
            text,
            timestamp: Date.now(),
          },
        ],
      },
    };
  });
}

export function setChatSuggestions(
  demoId: DemoId,
  sessionId: string,
  party: Party,
  suggestions: string[]
): DemoSession {
  return updateSession(demoId, sessionId, (session) => {
    const chatKey = party === "passenger" ? "passengerChat" : "driverChat";
    return {
      ...session,
      [chatKey]: {
        ...session[chatKey],
        suggestions: suggestions.slice(0, 2),
      },
    };
  });
}

export function markComplaintDrafted(
  demoId: DemoId,
  sessionId: string,
  party: Party
): DemoSession {
  return updateSession(demoId, sessionId, (session) => {
    const chatKey = party === "passenger" ? "passengerChat" : "driverChat";
    return {
      ...session,
      [chatKey]: {
        ...session[chatKey],
        complaintDrafted: true,
      },
    };
  });
}

export function enterPrivateSupport(
  demoId: DemoId,
  sessionId: string,
  _party: Party
): DemoSession {
  void _party; // parameter kept for API symmetry
  return updateSession(demoId, sessionId, (session) => {
    if (session.stage !== "none") return session;
    return {
      ...session,
      stage: "private_support",
    };
  });
}

export function fileFormalComplaint(
  demoId: DemoId,
  sessionId: string,
  category: string,
  description: string,
  filedBy: Party
): DemoSession {
  return updateSession(demoId, sessionId, (session) => ({
    ...session,
    stage: "formal_filed",
    formalComplaint: {
      category,
      description,
      filedAt: Date.now(),
      filedBy,
    },
  }));
}

export function selectPartyView(session: DemoSession, party: Party): PartyView {
  const myChat = party === "passenger" ? session.passengerChat : session.driverChat;
  return {
    demoId: session.demoId,
    sessionId: session.sessionId,
    stage: session.stage,
    tripStatus: session.tripStatus,
    formalComplaint: session.formalComplaint,
    evidenceFrozen: session.evidenceFrozen,
    trip: session.trip,
    myChat,
    otherPartyHasComplaint:
      session.formalComplaint !== undefined && session.formalComplaint.filedBy !== party,
  };
}

export type SessionListener = (session: DemoSession) => void;

export function subscribeToSession(
  demoId: DemoId,
  sessionId: string,
  listener: SessionListener
): () => void {
  const bc = getBroadcastChannel();

  const onBcMessage = (e: MessageEvent) => {
    if (
      e.data?.type === "session-updated" &&
      e.data.demoId === demoId &&
      e.data.sessionId === sessionId
    ) {
      const latest = readSessionRaw(demoId, sessionId);
      if (latest) listener(latest);
    }
  };

  const onStorage = (e: StorageEvent) => {
    if (e.key === storageKey(demoId, sessionId)) {
      const latest = readSessionRaw(demoId, sessionId);
      if (latest) listener(latest);
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      const latest = readSessionRaw(demoId, sessionId);
      if (latest) listener(latest);
    }
  };

  if (bc) bc.addEventListener("message", onBcMessage);
  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    if (bc) bc.removeEventListener("message", onBcMessage);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
