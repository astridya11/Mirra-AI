"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { DemoId, Party, DemoSession } from "@/src/types/session";
import { useI18n } from "@/src/context/I18nContext";
import { useTranslation } from "@/src/hooks/useTranslation";
import {
  getOrCreateSession,
  addChatMessage,
  setChatSuggestions,
  markComplaintDrafted,
  enterPrivateSupport,
  fileFormalComplaint,
  selectPartyView,
  subscribeToSession,
  setEvidence,
} from "@/src/lib/sessionStorage";
import { getPrivateMirraResponse } from "@/src/lib/privateMirraAdapter";
import { getScenario } from "@/src/lib/demoScenarios";
import MobileLayout from "./MobileLayout";
import TripCard from "./TripCard";
import MirraChat from "./MirraChat";
import EvidenceIntake from "./EvidenceIntake";
import type { DemoEvidence } from "@/src/types/session";

interface RydeAppProps {
  demoId: DemoId;
  sessionId: string;
  party: Party;
  embedded?: boolean;
}

type Screen = "trip" | "chat" | "complaint" | "evidence";

export default function RydeApp({ demoId, sessionId, party, embedded = false }: RydeAppProps) {
  const { locale } = useI18n();
  const t = useTranslation();
  const [session, setSession] = useState<DemoSession | null>(() =>
    getOrCreateSession(demoId, sessionId)
  );
  const [screen, setScreen] = useState<Screen>("trip");
  const [isTyping, setIsTyping] = useState(false);
  const [complaintText, setComplaintText] = useState("");
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to cross-tab session updates
  useEffect(() => {
    const unsubscribe = subscribeToSession(demoId, sessionId, (latest) => {
      setSession((prev) => {
        if (!prev) return latest;
        return latest.updatedAt >= prev.updatedAt ? latest : prev;
      });
    });

    return () => {
      unsubscribe();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [demoId, sessionId]);

  const view = session ? selectPartyView(session, party) : null;

  const handleSendMessage = useCallback(
    (text: string) => {
      if (!session) return;
      let updated = addChatMessage(demoId, sessionId, party, text, "user");
      setSession(updated);
      setIsTyping(true);

      const response = getPrivateMirraResponse({
        demoId,
        party,
        message: text,
        locale,
        chat: updated[party === "passenger" ? "passengerChat" : "driverChat"],
        tripStatus: updated.tripStatus,
      });

      typingTimeoutRef.current = setTimeout(() => {
        updated = addChatMessage(demoId, sessionId, party, response.response, "mirra");
        updated = setChatSuggestions(demoId, sessionId, party, response.suggestions);
        if (response.action === "draft_complaint") {
          updated = markComplaintDrafted(demoId, sessionId, party);
          setScreen(demoId === "3" && party === "driver" ? "evidence" : "complaint");
        }
        setSession(updated);
        setIsTyping(false);
      }, 800 + Math.random() * 600);
    },
    [session, party, demoId, sessionId, locale]
  );

  const handleSuggestionClick = useCallback(
    (text: string) => {
      if (!session) return;
      const updated = setChatSuggestions(demoId, sessionId, party, []);
      setSession(updated);
      handleSendMessage(text);
    },
    [session, party, demoId, sessionId, handleSendMessage]
  );

  const handleFileComplaint = useCallback(() => {
    if (!session || !complaintText.trim()) return;
    const scenario = getScenario(demoId);
    const category = scenario?.titleEn ?? "General Dispute";
    const updated = fileFormalComplaint(demoId, sessionId, category, complaintText.trim(), party);
    setSession(updated);
    setComplaintText("");
    setScreen("trip");
  }, [session, complaintText, demoId, sessionId, party]);

  const handleEvidenceChange = useCallback(
    (evidence: DemoEvidence) => {
      if (!session) return;
      const updated = setEvidence(demoId, sessionId, evidence);
      setSession(updated);
    },
    [session, demoId, sessionId]
  );

  const handleEvidenceSubmit = useCallback(() => {
    if (!session) return;
    const scenario = getScenario(demoId);
    const category = scenario?.titleEn ?? "General Dispute";
    const description =
      locale === "zh"
        ? `司机提交了清洁费索赔，并附上了照片和收据证据。`
        : `Driver submitted a cleaning-fee claim with photo and receipt evidence.`;
    const updated = fileFormalComplaint(demoId, sessionId, category, description, party);
    setSession(updated);
    setScreen("trip");
  }, [session, demoId, sessionId, party, locale]);

  const handleEvidenceSkip = useCallback(() => {
    if (!session) return;
    const updated = setEvidence(demoId, sessionId, { skipped: true });
    setSession(updated);
    const scenario = getScenario(demoId);
    const category = scenario?.titleEn ?? "General Dispute";
    const description =
      locale === "zh"
        ? `司机提交了清洁费索赔，但未提供证据。`
        : `Driver submitted a cleaning-fee claim without providing evidence.`;
    const updated2 = fileFormalComplaint(demoId, sessionId, category, description, party);
    setSession(updated2);
    setScreen("trip");
  }, [session, demoId, sessionId, party, locale]);

  const startPrivateChat = useCallback(() => {
    if (!session) return;
    let updated = enterPrivateSupport(demoId, sessionId, party);
    const scenario = getScenario(demoId);
    const chatKey = party === "passenger" ? "passengerChat" : "driverChat";
    if (session[chatKey].messages.length === 0 && scenario) {
      const initialText = locale === "zh"
        ? (party === "passenger" ? scenario.passengerInitialTextZh : scenario.driverInitialTextZh)
        : (party === "passenger" ? scenario.passengerInitialTextEn : scenario.driverInitialTextEn);
      updated = addChatMessage(demoId, sessionId, party, initialText, "user");
      updated = setChatSuggestions(demoId, sessionId, party, []);
      setSession(updated);
      setIsTyping(true);

      const response = getPrivateMirraResponse({
        demoId,
        party,
        message: initialText,
        locale,
        chat: updated[chatKey],
        tripStatus: updated.tripStatus,
      });

      typingTimeoutRef.current = setTimeout(() => {
        updated = addChatMessage(demoId, sessionId, party, response.response, "mirra");
        updated = setChatSuggestions(demoId, sessionId, party, response.suggestions);
        setSession(updated);
        setIsTyping(false);
      }, 1000);
    } else {
      setSession(updated);
    }
    setScreen("chat");
  }, [session, party, demoId, sessionId, locale]);

  if (!view) {
    return (
      <MobileLayout embedded={embedded}>
        <div className="flex h-full items-center justify-center">
          <div className="animate-pulse text-sm text-[#9CA3AF]">Loading...</div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout
      embedded={embedded}
      title={
        screen === "chat"
          ? t("rydeApp.chatWithMirra")
          : screen === "complaint"
          ? t("rydeApp.fileComplaint")
          : screen === "evidence"
          ? locale === "zh"
            ? "证据提交"
            : "Evidence Submission"
          : "Ryde"
      }
      showBack={screen !== "trip"}
      onBack={() => setScreen("trip")}
    >
      {screen === "trip" && (
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 no-scrollbar">
            <TripCard trip={view.trip} variant={party} />

            {/* Formal complaint banner */}
            {view.formalComplaint && (
              <div className="rounded-xl bg-[#FDF1F3] border border-[#E84360]/20 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-2 w-2 rounded-full bg-[#E84360]" />
                  <p className="text-xs font-bold text-[#E84360]">
                    {view.otherPartyHasComplaint
                      ? t("rydeApp.complaintReceived")
                      : t("rydeApp.complaintFiled")}
                  </p>
                </div>
                <p className="text-sm text-[#111827] font-medium">{view.formalComplaint.category}</p>
                <p className="text-xs text-[#6B7280] mt-1">{view.formalComplaint.description}</p>
                <p className="text-[10px] text-[#9CA3AF] mt-2 uppercase font-medium">
                  {t("rydeApp.disputeUnderReview")}
                </p>
              </div>
            )}

            {/* MIRRA entry point */}
            {!view.formalComplaint && (
              <button
                onClick={startPrivateChat}
                className="w-full flex items-center gap-3 rounded-xl bg-white border border-gray-100 p-4 shadow-sm hover:shadow-md hover:border-[#E84360]/20 active:scale-[0.99] transition-all"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FDF1F3]">
                  <svg className="h-5 w-5 text-[#E84360]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                  </svg>
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold text-[#111827]">{t("rydeApp.privateMirra")}</p>
                  <p className="text-xs text-[#6B7280]">
                    {party === "passenger"
                      ? t("rydeApp.privateNoticePassenger")
                      : t("rydeApp.privateNoticeDriver")}
                  </p>
                </div>
                <svg className="h-4 w-4 text-[#9CA3AF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            {/* File complaint button (after drafting) */}
            {view.myChat.complaintDrafted && !view.formalComplaint && (
              <button
                onClick={() => {
                  if (demoId === "3" && party === "driver") {
                    setScreen("evidence");
                  } else {
                    setScreen("complaint");
                  }
                }}
                className="w-full rounded-xl bg-[#E84360] px-4 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#DE3557] active:scale-[0.98] transition-all"
              >
                {demoId === "3" && party === "driver"
                  ? locale === "zh"
                    ? "开始清洁费索赔"
                    : "Start Cleaning Fee Claim"
                  : t("rydeApp.fileComplaint")}
              </button>
            )}
          </div>

          {/* Bottom nav */}
          <div className="shrink-0 border-t border-gray-100 bg-white px-6 py-2 flex items-center justify-between">
            <NavItem icon="home" label={t("rydeApp.home")} active />
            <NavItem icon="activity" label={t("rydeApp.activity")} />
            <NavItem icon="help" label={t("rydeApp.help")} />
            <NavItem icon="account" label={t("rydeApp.account")} />
          </div>
        </div>
      )}

      {screen === "chat" && (
        <MirraChat
          messages={view.myChat.messages}
          suggestions={view.myChat.suggestions}
          party={party}
          onSendMessage={handleSendMessage}
          onSuggestionClick={handleSuggestionClick}
          isTyping={isTyping}
        />
      )}

      {screen === "evidence" && (
        <EvidenceIntake
          evidence={view.evidence}
          frozen={view.evidenceFrozen}
          onChange={handleEvidenceChange}
          onSubmit={handleEvidenceSubmit}
          onSkip={handleEvidenceSkip}
        />
      )}

      {screen === "complaint" && (
        <div className="flex h-full flex-col px-4 py-4">
          <p className="text-sm text-[#6B7280] mb-4">
            {locale === "zh"
              ? "请描述您的争议。此信息将与另一方共享以供审查。"
              : "Please describe your dispute. This will be shared with the other party for review."}
          </p>
          <textarea
            value={complaintText}
            onChange={(e) => setComplaintText(e.target.value)}
            placeholder={locale === "zh" ? "描述发生了什么..." : "Describe what happened..."}
            className="flex-1 rounded-xl bg-[#F9FAFB] border border-gray-200 p-4 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#E84360]/20 resize-none mb-4"
          />
          <button
            onClick={handleFileComplaint}
            disabled={!complaintText.trim()}
            className="w-full rounded-xl bg-[#E84360] px-4 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#DE3557] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
          >
            {t("rydeApp.fileComplaint")}
          </button>
        </div>
      )}
    </MobileLayout>
  );
}

function NavItem({ icon, label, active = false }: { icon: string; label: string; active?: boolean }) {
  const iconMap: Record<string, React.ReactNode> = {
    home: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
    activity: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    help: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.724.361-1.194.983-1.194 1.666v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
      </svg>
    ),
    account: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  };

  return (
    <button className={`flex flex-col items-center gap-0.5 py-1 ${active ? "text-[#E84360]" : "text-[#9CA3AF]"}`}>
      {iconMap[icon]}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
