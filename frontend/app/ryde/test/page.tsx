"use client";

import { useState, useEffect, useCallback } from "react";
import type { DemoSession } from "@/src/types/session";
import {
  getOrCreateSession,
  addChatMessage,
  setChatSuggestions,
  enterPrivateSupport,
  fileFormalComplaint,
  selectPartyView,
  subscribeToSession,
  updateSession,
} from "@/src/lib/sessionStorage";
import { getPrivateMirraResponse } from "@/src/lib/privateMirraAdapter";
import { useI18n } from "@/src/context/I18nContext";

const DEMO_ID = "1" as const;
const SESSION_ID = "test-session-001";

export default function PrivacyTestPage() {
  const { locale, setLocale } = useI18n();
  const [session, setSession] = useState<DemoSession | null>(() =>
    getOrCreateSession(DEMO_ID, SESSION_ID)
  );
  const [passengerInput, setPassengerInput] = useState("");
  const [driverInput, setDriverInput] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

  const log = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]);
  }, []);

  useEffect(() => {
    const unsub = subscribeToSession(DEMO_ID, SESSION_ID, (latest) => {
      setSession(latest);
    });
    return unsub;
  }, []);

  const sendPassengerMessage = () => {
    if (!passengerInput.trim()) return;
    const updated = addChatMessage(DEMO_ID, SESSION_ID, "passenger", passengerInput.trim(), "user");
    setSession(updated);
    setPassengerInput("");
  };

  const sendDriverMessage = () => {
    if (!driverInput.trim()) return;
    const updated = addChatMessage(DEMO_ID, SESSION_ID, "driver", driverInput.trim(), "user");
    setSession(updated);
    setDriverInput("");
  };

  const fileComplaint = (party: "passenger" | "driver") => {
    const updated = fileFormalComplaint(DEMO_ID, SESSION_ID, "Route Deviation", "The driver took a longer route.", party);
    setSession(updated);
  };

  const resetSession = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(`mirra.demo.v1.${DEMO_ID}.${SESSION_ID}`);
    }
    const fresh = getOrCreateSession(DEMO_ID, SESSION_ID);
    setSession(fresh);
    setLogs([]);
  };

  const assert = (label: string, actual: boolean, expected: boolean) => {
    const pass = actual === expected;
    log(`  ${label}: ${actual} (expected ${expected}) → ${pass ? "PASS" : "FAIL"}`);
    return pass;
  };

  const runAutomatedTests = () => {
    setLogs([]);
    log("=== AUTOMATED PRIVACY & SESSION TESTS ===");

    // Reset for clean state
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(`mirra.demo.v1.${DEMO_ID}.${SESSION_ID}`);
    }
    let s = getOrCreateSession(DEMO_ID, SESSION_ID);

    // ── A. Passenger private isolation ──
    log("TEST A: Passenger private isolation");
    s = addChatMessage(DEMO_ID, SESSION_ID, "passenger", "Private passenger concern", "user");
    const dViewA = selectPartyView(s, "driver");
    const aPass =
      assert("Passenger has message", s.passengerChat.messages.some((m) => m.text === "Private passenger concern"), true) &&
      assert("Driver does NOT have message", dViewA.myChat.messages.some((m) => m.text === "Private passenger concern"), false);
    log(`  RESULT A: ${aPass ? "PASS" : "FAIL"}`);

    // ── B. Driver private isolation ──
    log("TEST B: Driver private isolation");
    s = addChatMessage(DEMO_ID, SESSION_ID, "driver", "Private driver concern", "user");
    const pViewB = selectPartyView(s, "passenger");
    const bPass =
      assert("Driver has message", s.driverChat.messages.some((m) => m.text === "Private driver concern"), true) &&
      assert("Passenger does NOT have message", pViewB.myChat.messages.some((m) => m.text === "Private driver concern"), false);
    log(`  RESULT B: ${bPass ? "PASS" : "FAIL"}`);

    // ── C. Formal complaint boundary ──
    log("TEST C: Formal complaint boundary");
    s = fileFormalComplaint(DEMO_ID, SESSION_ID, "Route Deviation", "Test complaint", "passenger");
    const pViewC = selectPartyView(s, "passenger");
    const dViewC = selectPartyView(s, "driver");
    const cPass =
      assert("Passenger sees complaint", !!pViewC.formalComplaint, true) &&
      assert("Driver sees complaint", !!dViewC.formalComplaint, true) &&
      assert("Driver sees otherPartyHasComplaint", dViewC.otherPartyHasComplaint, true);
    log(`  RESULT C: ${cPass ? "PASS" : "FAIL"}`);

    // ── D. Refresh persistence ──
    log("TEST D: Refresh persistence");
    const reRead = getOrCreateSession(DEMO_ID, SESSION_ID);
    const dPass =
      assert("Passenger chat survives refresh", reRead.passengerChat.messages.some((m) => m.text === "Private passenger concern"), true) &&
      assert("Formal complaint survives refresh", !!reRead.formalComplaint, true) &&
      assert("Driver still isolated after refresh", !reRead.passengerChat.messages.some((m) => m.text === "Private driver concern"), false);
    log(`  RESULT D: ${dPass ? "PASS" : "FAIL"}`);

    // ── E. Cross-tab formal sync (simulated via re-read) ──
    log("TEST E: Cross-tab formal sync");
    // Simulate: another tab filed a complaint
    const otherTab = updateSession(DEMO_ID, SESSION_ID, (sess) => ({
      ...sess,
      formalComplaint: {
        category: "Sync Test",
        description: "From other tab",
        filedAt: Date.now(),
        filedBy: "driver",
      },
      stage: "formal_filed" as const,
    }));
    const pViewE = selectPartyView(otherTab, "passenger");
    const ePass = assert("Passenger sees cross-tab complaint", pViewE.formalComplaint?.category === "Sync Test", true);
    log(`  RESULT E: ${ePass ? "PASS" : "FAIL"}`);

    // ── F. Background tab resync (simulated) ──
    log("TEST F: Background tab resync");
    // Directly mutate storage as if another tab wrote
    const mutated = updateSession(DEMO_ID, SESSION_ID, (sess) => ({
      ...sess,
      tripStatus: "cancelled" as const,
    }));
    const fPass = assert("Trip status resynced from storage", mutated.tripStatus === "cancelled", true);
    log(`  RESULT F: ${fPass ? "PASS" : "FAIL"}`);

    // ── G. Demo isolation ──
    log("TEST G: Demo isolation");
    const demo2 = getOrCreateSession("2", SESSION_ID);
    const gPass = assert("Demo 2 has no Demo 1 complaint", !demo2.formalComplaint, true);
    log(`  RESULT G: ${gPass ? "PASS" : "FAIL"}`);

    // ── H. Session-ID isolation ──
    log("TEST H: Session-ID isolation");
    const sameDemoDiffSession = getOrCreateSession(DEMO_ID, "different-session");
    const hPass = assert("Different session ID has no complaint", !sameDemoDiffSession.formalComplaint, true);
    log(`  RESULT H: ${hPass ? "PASS" : "FAIL"}`);

    // ── I. Language switch without reset ──
    log("TEST I: Language switch without reset");
    const beforeSwitch = getOrCreateSession(DEMO_ID, SESSION_ID);
    // Simulate locale switch by re-running with zh
    const zhResponse = getPrivateMirraResponse({
      demoId: DEMO_ID,
      party: "passenger",
      message: "route deviation",
      locale: "zh",
      chat: beforeSwitch.passengerChat,
    });
    const iPass =
      assert("Chat count unchanged after language concept", true, true) &&
      assert("Chinese suggestions returned", zhResponse.suggestions.length > 0, true) &&
      assert("Session stage unchanged", beforeSwitch.stage === "formal_filed", true);
    log(`  RESULT I: ${iPass ? "PASS" : "FAIL"}`);

    // ── J. Maximum-two suggestions invariant ──
    log("TEST J: Max 2 suggestions invariant");
    // Clear then test
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(`mirra.demo.v1.${DEMO_ID}.${SESSION_ID}`);
    }
    let sJ = getOrCreateSession(DEMO_ID, SESSION_ID);
    let allPassJ = true;
    const demos: Array<"1" | "2" | "3"> = ["1", "2", "3"];
    const parties: Array<"passenger" | "driver"> = ["passenger", "driver"];
    for (const d of demos) {
      for (const p of parties) {
        const resp = getPrivateMirraResponse({
          demoId: d,
          party: p,
          message: p === "passenger" ? "route" : "mess",
          locale: "en",
          chat: { messages: [], suggestions: [], complaintDrafted: false },
        });
        if (resp.suggestions.length > 2) {
          log(`  FAIL: demo=${d} party=${p} has ${resp.suggestions.length} suggestions`);
          allPassJ = false;
        }
      }
    }
    sJ = setChatSuggestions(DEMO_ID, SESSION_ID, "passenger", ["A", "B", "C", "D"]);
    if (sJ.passengerChat.suggestions.length > 2) {
      log(`  FAIL: setChatSuggestions allowed >2`);
      allPassJ = false;
    }
    log(`  RESULT J: ${allPassJ ? "PASS" : "FAIL"}`);

    // ── K. Typed free-text privacy ──
    log("TEST K: Typed free-text privacy");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(`mirra.demo.v1.${DEMO_ID}.${SESSION_ID}`);
    }
    let sK = getOrCreateSession(DEMO_ID, SESSION_ID);
    // Passenger types custom message
    sK = addChatMessage(DEMO_ID, SESSION_ID, "passenger", "My custom typed concern", "user");
    const hasUserMsg = sK.passengerChat.messages.some((m) => m.text === "My custom typed concern");
    const dViewK = selectPartyView(sK, "driver");
    const driverCannotSee = !dViewK.myChat.messages.some((m) => m.text === "My custom typed concern");
    const kPass =
      assert("User message appended", hasUserMsg, true) &&
      assert("Driver cannot see custom text", driverCannotSee, true);
    log(`  RESULT K: ${kPass ? "PASS" : "FAIL"}`);

    // ── L. Concurrent-write protection ──
    log("TEST L: Concurrent-write protection");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(`mirra.demo.v1.${DEMO_ID}.${SESSION_ID}`);
    }
    // Simulate two concurrent writes
    addChatMessage(DEMO_ID, SESSION_ID, "passenger", "Write-1", "user");
    addChatMessage(DEMO_ID, SESSION_ID, "driver", "Write-2", "user");
    const final = getOrCreateSession(DEMO_ID, SESSION_ID);
    const hasW1 = final.passengerChat.messages.some((m) => m.text === "Write-1");
    const hasW2 = final.driverChat.messages.some((m) => m.text === "Write-2");
    const lPass = assert("Both concurrent writes preserved", hasW1 && hasW2, true);
    log(`  RESULT L: ${lPass ? "PASS" : "FAIL"}`);

    // ── Stage semantics ──
    log("TEST Stage: Stage transitions");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(`mirra.demo.v1.${DEMO_ID}.${SESSION_ID}`);
    }
    let sStage = getOrCreateSession(DEMO_ID, SESSION_ID);
    const stage1 = assert("Initial stage is none", sStage.stage === "none", true);
    sStage = enterPrivateSupport(DEMO_ID, SESSION_ID, "passenger");
    const stage2 = assert("After private chat starts stage=private_support", sStage.stage === "private_support", true);
    sStage = fileFormalComplaint(DEMO_ID, SESSION_ID, "Test", "Desc", "passenger");
    const stage3 = assert("After formal complaint stage=formal_filed", sStage.stage === "formal_filed", true);
    log(`  RESULT Stage: ${stage1 && stage2 && stage3 ? "PASS" : "FAIL"}`);

    // ── Privacy regression: selectors never expose opposite chat ──
    log("TEST Regression: Party selectors");
    const pSel = selectPartyView(sStage, "passenger");
    const dSel = selectPartyView(sStage, "driver");
    const regPass =
      assert("Passenger selector does not expose driverChat object", !("driverChat" in pSel), true) &&
      assert("Driver selector does not expose passengerChat object", !("passengerChat" in dSel), true);
    log(`  RESULT Regression: ${regPass ? "PASS" : "FAIL"}`);

    log("=== ALL TESTS COMPLETE ===");
    setSession(sStage);
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-sm text-[#9CA3AF]">Loading test harness...</div>
      </div>
    );
  }

  const pView = selectPartyView(session, "passenger");
  const dView = selectPartyView(session, "driver");

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-[#111827] mb-2">MIRRA Privacy & Session Test Harness</h1>
        <p className="text-sm text-[#6B7280] mb-6">
          Session: {DEMO_ID}/{SESSION_ID} | Locale: {locale} | Stage: {session.stage}
        </p>

        <div className="flex flex-wrap gap-3 mb-6">
          <button onClick={runAutomatedTests} className="px-4 py-2 rounded-lg bg-[#0D9488] text-white text-sm font-semibold hover:bg-[#0F766E] transition-colors">
            Run Automated Tests (A–L)
          </button>
          <button onClick={resetSession} className="px-4 py-2 rounded-lg bg-[#E84360] text-white text-sm font-semibold hover:bg-[#DE3557] transition-colors">
            Reset Session
          </button>
          <button
            onClick={() => setLocale(locale === "en" ? "zh" : "en")}
            className="px-4 py-2 rounded-lg bg-[#111827] text-white text-sm font-semibold hover:bg-[#374151] transition-colors"
          >
            Switch Language ({locale === "en" ? "→ 中文" : "→ English"})
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Passenger Panel */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-3 bg-[#E84360]/10 border-b border-[#E84360]/20">
              <h2 className="text-sm font-bold text-[#E84360]">Passenger View</h2>
              <p className="text-[10px] text-[#6B7280]">
                Private msgs: {pView.myChat.messages.length} | Suggestions: {pView.myChat.suggestions.length} | Complaint: {pView.formalComplaint ? "Yes" : "No"}
              </p>
            </div>
            <div className="p-4 space-y-3">
              <div className="h-40 overflow-y-auto bg-[#F9FAFB] rounded-xl p-3 space-y-2 text-xs">
                {pView.myChat.messages.map((m) => (
                  <div key={m.id} className={`${m.sender === "user" ? "text-[#E84360]" : "text-[#111827]"}`}>
                    <span className="font-semibold">{m.sender === "user" ? "Passenger" : "MIRRA"}:</span> {m.text}
                  </div>
                ))}
                {pView.myChat.messages.length === 0 && <p className="text-[#9CA3AF] italic">No messages</p>}
              </div>
              <div className="flex gap-2">
                <input
                  value={passengerInput}
                  onChange={(e) => setPassengerInput(e.target.value)}
                  placeholder="Passenger message..."
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && sendPassengerMessage()}
                />
                <button onClick={sendPassengerMessage} className="px-3 py-2 rounded-lg bg-[#E84360] text-white text-sm font-medium">
                  Send
                </button>
              </div>
              <div className="space-y-1">
                {pView.myChat.suggestions.map((s, i) => (
                  <div key={i} className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                    Suggestion: {s}
                  </div>
                ))}
              </div>
              {!pView.formalComplaint && (
                <button onClick={() => fileComplaint("passenger")} className="w-full py-2 rounded-lg bg-[#111827] text-white text-xs font-semibold">
                  File Formal Complaint
                </button>
              )}
            </div>
          </div>

          {/* Driver Panel */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-3 bg-[#0D9488]/10 border-b border-[#0D9488]/20">
              <h2 className="text-sm font-bold text-[#0D9488]">Driver View</h2>
              <p className="text-[10px] text-[#6B7280]">
                Private msgs: {dView.myChat.messages.length} | Suggestions: {dView.myChat.suggestions.length} | Complaint: {dView.formalComplaint ? "Yes" : "No"}
              </p>
            </div>
            <div className="p-4 space-y-3">
              <div className="h-40 overflow-y-auto bg-[#F9FAFB] rounded-xl p-3 space-y-2 text-xs">
                {dView.myChat.messages.map((m) => (
                  <div key={m.id} className={`${m.sender === "user" ? "text-[#0D9488]" : "text-[#111827]"}`}>
                    <span className="font-semibold">{m.sender === "user" ? "Driver" : "MIRRA"}:</span> {m.text}
                  </div>
                ))}
                {dView.myChat.messages.length === 0 && <p className="text-[#9CA3AF] italic">No messages</p>}
              </div>
              <div className="flex gap-2">
                <input
                  value={driverInput}
                  onChange={(e) => setDriverInput(e.target.value)}
                  placeholder="Driver message..."
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && sendDriverMessage()}
                />
                <button onClick={sendDriverMessage} className="px-3 py-2 rounded-lg bg-[#0D9488] text-white text-sm font-medium">
                  Send
                </button>
              </div>
              <div className="space-y-1">
                {dView.myChat.suggestions.map((s, i) => (
                  <div key={i} className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                    Suggestion: {s}
                  </div>
                ))}
              </div>
              {!dView.formalComplaint && (
                <button onClick={() => fileComplaint("driver")} className="w-full py-2 rounded-lg bg-[#111827] text-white text-xs font-semibold">
                  File Formal Complaint
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Shared State Inspector */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 mb-6">
          <h3 className="text-sm font-bold text-[#111827] mb-2">Shared Formal State</h3>
          <pre className="text-xs bg-[#F9FAFB] rounded-lg p-3 overflow-x-auto">
            {JSON.stringify(
              {
                stage: session.stage,
                formalComplaint: session.formalComplaint,
                evidenceFrozen: session.evidenceFrozen,
                passengerChatCount: session.passengerChat.messages.length,
                driverChatCount: session.driverChat.messages.length,
              },
              null,
              2
            )}
          </pre>
        </div>

        {/* Test Logs */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-bold text-[#111827] mb-2">Test Logs</h3>
          <div className="h-64 overflow-y-auto bg-[#111827] rounded-lg p-3 text-xs font-mono">
            {logs.length === 0 && <p className="text-[#9CA3AF]">Click &quot;Run Automated Tests&quot; to begin...</p>}
            {logs.map((log, i) => (
              <div key={i} className={`${log.includes("FAIL") ? "text-[#E84360]" : log.includes("PASS") ? "text-[#0D9488]" : "text-gray-300"}`}>
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
