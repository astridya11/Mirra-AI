"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IOSHeader } from "@/src/components/IOSHeader";
import { TypingDots } from "@/src/components/TypingDots";

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const caseId = searchParams.get("caseId") || "DISP-001";
  const tripId = searchParams.get("tripId") || "TRIP-2026-08112";

  const [messages, setMessages] = useState<
    { id: string; sender: "bot" | "user"; text: string }[]
  >([
    {
      id: "m1",
      sender: "bot",
      text: `Thank you for selecting your trip (${tripId}). Please describe your issue in detail in a single message so our Miora AI Tribunal can assist you.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [botTyping, setBotTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, botTyping]);

  const handleSend = () => {
    if (!input.trim() || submitted) return;
    const userMsg = { id: `u${Date.now()}`, sender: "user" as const, text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSubmitted(true);
    setBotTyping(true);

    setTimeout(() => {
      setBotTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `b${Date.now()}`,
          sender: "bot",
          text: "Dispute Logged — Miora AI Tribunal Session Active. Your case is now being reviewed by our multi-agent AI system. Please wait while the tribunal deliberates...",
        },
      ]);
    }, 1500);

    setTimeout(() => {
      router.push(`/tribunal/${caseId}`);
    }, 3500);
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      <IOSHeader
        title="Ryde AI Support"
        onBack={() => router.push("/help")}
        rightAction={
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34C759]" />
            <span className="text-[12px] text-[#6B7280]">Online</span>
          </div>
        }
      />

      {/* Chat messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}
        {botTyping && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[#FDF1F3] flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-[#E84360]">M</span>
            </div>
            <div className="bg-[#F3F4F6] rounded-2xl rounded-tl-sm px-4 py-3">
              <TypingDots />
            </div>
          </div>
        )}

        {/* Status badge after submission */}
        {submitted && !botTyping && (
          <div className="flex justify-center pt-2">
            <div className="flex items-center gap-2 rounded-full bg-[#FDF1F3] px-4 py-2 animate-fade-in">
              <span className="w-2 h-2 rounded-full bg-[#E84360] animate-pulse-dot" />
              <span className="text-[13px] font-semibold text-[#E84360]">
                Dispute Logged — Miora AI Tribunal Session Active
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      {!submitted ? (
        <div className="border-t border-gray-100 px-4 py-3 bg-white">
          <div className="flex items-end gap-2">
            <div className="flex-1 flex items-center gap-2 bg-[#F3F4F6] rounded-2xl px-3 py-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                placeholder="Type your message..."
                className="flex-1 bg-transparent text-[15px] text-[#111827] placeholder:text-[#9CA3AF] outline-none"
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-[#E84360] text-white disabled:bg-gray-200 disabled:text-gray-400 active:scale-95 transition-transform"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.11A20.45 20.45 0 0021.5 12 20.45 20.45 0 003.27 20.89L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-100 px-4 py-3.5 bg-white">
          <div className="flex items-center justify-center text-[14px] text-[#6B7280]">
            <svg className="w-4 h-4 mr-2 animate-spin text-[#E84360]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Launching AI Tribunal...
          </div>
        </div>
      )}
    </div>
  );
}

function ChatBubble({ message }: { message: { sender: "bot" | "user"; text: string } }) {
  const isBot = message.sender === "bot";
  return (
    <div className={`flex items-end gap-2 ${isBot ? "justify-start" : "justify-end"} animate-slide-up`}>
      {isBot && (
        <div className="w-7 h-7 rounded-full bg-[#FDF1F3] flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] font-bold text-[#E84360]">M</span>
        </div>
      )}
      <div
        className={`max-w-[75%] px-4 py-2.5 text-[15px] leading-relaxed ${
          isBot
            ? "bg-[#F3F4F6] text-[#111827] rounded-2xl rounded-tl-sm"
            : "bg-[#E84360] text-white rounded-2xl rounded-tr-sm"
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <ChatContent />
    </Suspense>
  );
}
