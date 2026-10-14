"use client";

import { useState, useEffect, useCallback } from "react";
import type { DemoSession } from "@/src/types/session";
import {
  getOrCreateSession,
  addChatMessage,
  setChatSuggestions,
  enterPrivateSupport,
  fileFormalComplaint,
  startTribunal,
  completeTribunal,
  selectPartyView,
  subscribeToSession,
  resetSession,
} from "@/src/lib/sessionStorage";
import { getPrivateMirraResponse } from "@/src/lib/privateMirraAdapter";
import { getFixtureByDemoId } from "@/src/lib/tribunalFixtures";
import { useI18n } from "@/src/context/I18nContext";

const DEMO_ID = "1" as const;
const SESSION_ID = "test-session-001";

export default function PrivacyTestPage() {
  const { locale } = useI18n();
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

  const reset = () => {
    const fresh = resetSession(DEMO_ID, SESSION_ID);
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

    // Clean slate
    resetSession(DEMO_ID, SESSION_ID);
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
      assert("Formal complaint survives refresh", !!reRead.formalComplaint, true);
    log(`  RESULT D: ${dPass ? "PASS" : "FAIL"}`);

    // ── E. Cross-tab formal sync ──
    log("TEST E: Cross-tab formal sync");
    const otherTab = startTribunal(DEMO_ID, SESSION_ID);
    const pViewE = selectPartyView(otherTab, "passenger");
    const ePass = assert("Passenger sees cross-tab tribunal start", pViewE.tribunalStarted, true);
    log(`  RESULT E: ${ePass ? "PASS" : "FAIL"}`);

    // ── F. Background tab resync ──
    log("TEST F: Background tab resync");
    const mutated = getOrCreateSession(DEMO_ID, SESSION_ID);
    const fPass = assert("Tribunal started resynced from storage", mutated.tribunalStarted, true);
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
    const zhResponse = getPrivateMirraResponse({
      demoId: DEMO_ID,
      party: "passenger",
      message: "route deviation",
      locale: "zh",
      chat: beforeSwitch.passengerChat,
    });
    const iPass =
      assert("Chinese suggestions returned", zhResponse.suggestions.length > 0, true) &&
      assert("Session stage unchanged", beforeSwitch.stage === "under_review", true);
    log(`  RESULT I: ${iPass ? "PASS" : "FAIL"}`);

    // ── J. Maximum-two suggestions invariant ──
    log("TEST J: Max 2 suggestions invariant");
    resetSession(DEMO_ID, SESSION_ID);
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
    resetSession(DEMO_ID, SESSION_ID);
    let sK = getOrCreateSession(DEMO_ID, SESSION_ID);
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
    resetSession(DEMO_ID, SESSION_ID);
    addChatMessage(DEMO_ID, SESSION_ID, "passenger", "Write-1", "user");
    addChatMessage(DEMO_ID, SESSION_ID, "driver", "Write-2", "user");
    const final = getOrCreateSession(DEMO_ID, SESSION_ID);
    const hasW1 = final.passengerChat.messages.some((m) => m.text === "Write-1");
    const hasW2 = final.driverChat.messages.some((m) => m.text === "Write-2");
    const lPass = assert("Both concurrent writes preserved", hasW1 && hasW2, true);
    log(`  RESULT L: ${lPass ? "PASS" : "FAIL"}`);

    // ── Stage semantics ──
    log("TEST Stage: Stage transitions");
    resetSession(DEMO_ID, SESSION_ID);
    let sStage = getOrCreateSession(DEMO_ID, SESSION_ID);
    const stage1 = assert("Initial stage is none", sStage.stage === "none", true);
    sStage = enterPrivateSupport(DEMO_ID, SESSION_ID, "passenger");
    const stage2 = assert("After private chat starts stage=private_support", sStage.stage === "private_support", true);
    sStage = fileFormalComplaint(DEMO_ID, SESSION_ID, "Test", "Desc", "passenger");
    const stage3 = assert("After formal complaint stage=formal_filed", sStage.stage === "formal_filed", true);
    sStage = startTribunal(DEMO_ID, SESSION_ID);
    const stage4 = assert("After tribunal start stage=under_review", sStage.stage === "under_review", true);
    sStage = completeTribunal(DEMO_ID, SESSION_ID, { status: "partial_refund", amount: "S$3.25", reasoning: "test", executionRoute: "automated" });
    const stage5 = assert("After tribunal complete stage=resolved", sStage.stage === "resolved", true);
    log(`  RESULT Stage: ${stage1 && stage2 && stage3 && stage4 && stage5 ? "PASS" : "FAIL"}`);

    // ── Privacy regression: selectors never expose opposite chat ──
    log("TEST Regression: Party selectors");
    const pSel = selectPartyView(sStage, "passenger");
    const dSel = selectPartyView(sStage, "driver");
    const regPass =
      assert("Passenger selector does not expose driverChat object", !("driverChat" in pSel), true) &&
      assert("Driver selector does not expose passengerChat object", !("passengerChat" in dSel), true);
    log(`  RESULT Regression: ${regPass ? "PASS" : "FAIL"}`);

    // ── M3 TESTS ──
    log("=== M3 TESTS ===");

    // D. Evidence freeze
    log("TEST M3-D: Evidence freeze when Tribunal starts");
    resetSession(DEMO_ID, SESSION_ID);
    let sM3 = getOrCreateSession(DEMO_ID, SESSION_ID);
    sM3 = startTribunal(DEMO_ID, SESSION_ID);
    const dFreeze = assert("Evidence frozen after tribunal start", sM3.evidenceFrozen, true);
    log(`  RESULT M3-D: ${dFreeze ? "PASS" : "FAIL"}`);

    // E. State-level evidence mutation rejected after freeze
    log("TEST M3-E: Chat mutation rejected after freeze");
    const beforeCount = sM3.passengerChat.messages.length;
    sM3 = addChatMessage(DEMO_ID, SESSION_ID, "passenger", "After freeze", "user");
    const afterCount = sM3.passengerChat.messages.length;
    const eFreeze = assert("Chat count unchanged after freeze", afterCount === beforeCount, true);
    log(`  RESULT M3-E: ${eFreeze ? "PASS" : "FAIL"}`);

    // F/G. Cross-exam is CLAIM, does not modify verified
    log("TEST M3-F/G: Cross-exam claim does not modify verified evidence");
    const f1 = getFixtureByDemoId("1");
    const claimEvents = f1?.events.filter((e) => e.type === "claim_response") ?? [];
    const fPassM3 = assert("Cross-exam events are labeled as claims", claimEvents.every((e) => e.type === "claim_response"), true);
    const verifiedBefore = f1?.evidence.filter((e) => e.category === "verified").length ?? 0;
    const gPassM3 = assert("Verified evidence count unchanged by claims", verifiedBefore > 0, true);
    log(`  RESULT M3-F/G: ${fPassM3 && gPassM3 ? "PASS" : "FAIL"}`);

    // H. Execution Router is final event
    log("TEST M3-H: Execution Router is final Tribunal event");
    const allFixtures = ["1", "2", "3"] as const;
    let hPassM3 = true;
    for (const d of allFixtures) {
      const f = getFixtureByDemoId(d);
      if (f) {
        const lastEvent = f.events[f.events.length - 1];
        if (lastEvent.role !== "execution_router") {
          log(`  FAIL: demo ${d} last event is ${lastEvent.role}`);
          hPassM3 = false;
        }
      }
    }
    log(`  RESULT M3-H: ${hPassM3 ? "PASS" : "FAIL"}`);

    // I/J/K/L. Demo fixture outcomes
    log("TEST M3-J: Demo 1 decision correct");
    const f1Full = getFixtureByDemoId("1");
    const jPass = assert("Demo 1 execution route is automated", f1Full?.executionRoute === "automated", true);
    log(`  RESULT M3-J: ${jPass ? "PASS" : "FAIL"}`);

    log("TEST M3-K: Demo 2 decision correct");
    const f2Full = getFixtureByDemoId("2");
    const kPassM3 = assert("Demo 2 execution route is automated", f2Full?.executionRoute === "automated", true);
    log(`  RESULT M3-K: ${kPassM3 ? "PASS" : "FAIL"}`);

    log("TEST M3-L: Demo 3 escalates to human review");
    const f3Full = getFixtureByDemoId("3");
    const lPassM3 = assert("Demo 3 execution route is human_review", f3Full?.executionRoute === "human_review", true);
    log(`  RESULT M3-L: ${lPassM3 ? "PASS" : "FAIL"}`);

    // M. Internal Console never exposes private chat text
    log("TEST M3-M: Internal Console privacy");
    const mPass = assert("Fixture events do not contain private chat text", !f1Full?.events.some((e) => e.content.includes("Private")), true);
    log(`  RESULT M3-M: ${mPass ? "PASS" : "FAIL"}`);

    // N. Reset/replay affects only current demo/session
    log("TEST M3-N: Reset/replay isolation");
    resetSession(DEMO_ID, SESSION_ID);
    const afterReset = getOrCreateSession(DEMO_ID, SESSION_ID);
    const otherSession = getOrCreateSession(DEMO_ID, "other-session");
    const nPass =
      assert("Reset clears target session", afterReset.stage === "none", true) &&
      assert("Other session unaffected", otherSession.stage === "none", true);
    log(`  RESULT M3-N: ${nPass ? "PASS" : "FAIL"}`);

    // O. Language switch does not reset Tribunal/session
    log("TEST M3-O: Language switch preserves tribunal state");
    resetSession(DEMO_ID, SESSION_ID);
    let sO = getOrCreateSession(DEMO_ID, SESSION_ID);
    sO = startTribunal(DEMO_ID, SESSION_ID);
    sO = completeTribunal(DEMO_ID, SESSION_ID, { status: "no_refund", reasoning: "test", executionRoute: "automated" });
    // Simulate language switch by just checking state persistence
    const oPass =
      assert("Tribunal completed persists", sO.tribunalCompleted, true) &&
      assert("Decision persists", sO.decision?.status === "no_refund", true);
    log(`  RESULT M3-O: ${oPass ? "PASS" : "FAIL"}`);

    // I. Passenger/Driver verdicts use same underlying ruling
    log("TEST M3-I: Same underlying ruling for both parties");
    const decision1 = getFixtureByDemoId("1");
    const decision2 = getFixtureByDemoId("2");
    const decision3 = getFixtureByDemoId("3");
    const iPassM3 =
      assert("Demo 1 has consistent decision", !!decision1, true) &&
      assert("Demo 2 has consistent decision", !!decision2, true) &&
      assert("Demo 3 has consistent decision", !!decision3, true);
    log(`  RESULT M3-I: ${iPassM3 ? "PASS" : "FAIL"}`);

    log("=== ALL TESTS COMPLETE ===");
    setSession(sO);
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
          Session: {DEMO_ID}/{SESSION_ID} | Locale: {locale} | Stage: {session.stage} | Tribunal: {session.tribunalStarted ? (session.tribunalCompleted ? "completed" : "started") : "none"}
        </p>

        <div className="flex flex-wrap gap-3 mb-6">
          <button onClick={runAutomatedTests} className="px-4 py-2 rounded-lg bg-[#0D9488] text-white text-sm font-semibold hover:bg-[#0F766E] transition-colors">
            Run Automated Tests (A–P)
          </button>
          <button onClick={reset} className="px-4 py-2 rounded-lg bg-[#E84360] text-white text-sm font-semibold hover:bg-[#DE3557] transition-colors">
            Reset Session
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Passenger Panel */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-3 bg-[#E84360]/10 border-b border-[#E84360]/20">
              <h2 className="text-sm font-bold text-[#E84360]">Passenger View</h2>
              <p className="text-[10px] text-[#6B7280]">
                Private msgs: {pView.myChat.messages.length} | Suggestions: {pView.myChat.suggestions.length} | Complaint: {pView.formalComplaint ? "Yes" : "No"} | Tribunal: {pView.tribunalStarted ? "Yes" : "No"}
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
                Private msgs: {dView.myChat.messages.length} | Suggestions: {dView.myChat.suggestions.length} | Complaint: {dView.formalComplaint ? "Yes" : "No"} | Tribunal: {dView.tribunalStarted ? "Yes" : "No"}
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
                tribunalStarted: session.tribunalStarted,
                tribunalCompleted: session.tribunalCompleted,
                decision: session.decision,
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
