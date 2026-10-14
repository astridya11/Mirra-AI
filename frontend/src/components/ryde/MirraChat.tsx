"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ChatMessage, Party } from "@/src/types/session";
import { useTranslation } from "@/src/hooks/useTranslation";

interface MirraChatProps {
  messages: ChatMessage[];
  suggestions: string[];
  party: Party;
  onSendMessage: (text: string) => void;
  onSuggestionClick: (text: string) => void;
  isTyping?: boolean;
}

export default function MirraChat({
  messages,
  suggestions,
  party,
  onSendMessage,
  onSuggestionClick,
  isTyping = false,
}: MirraChatProps) {
  const t = useTranslation();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text) return;
      setInput("");
      onSendMessage(text);
    },
    [input, onSendMessage]
  );

  const handleSuggestion = useCallback(
    (text: string) => {
      onSuggestionClick(text);
    },
    [onSuggestionClick]
  );

  return (
    <div className="flex flex-col h-full bg-[#F9FAFB]">
      {/* Privacy notice */}
      <div className="px-4 py-2 bg-[#FDF1F3] border-b border-[#E84360]/10">
        <p className="text-[10px] text-center text-[#E84360] font-medium">
          {party === "passenger" ? t("rydeApp.privateNoticePassenger") : t("rydeApp.privateNoticeDriver")}
        </p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 no-scrollbar">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.sender === "user"
                  ? "bg-[#E84360] text-white rounded-br-md"
                  : "bg-white text-[#111827] border border-gray-100 rounded-bl-md shadow-sm"
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[#9CA3AF] font-medium">{t("rydeApp.mirraIsTyping")}</span>
                <div className="flex gap-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#9CA3AF] animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-[#9CA3AF] animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-[#9CA3AF] animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && !isTyping && (
        <div className="px-4 pb-2 space-y-2">
          <p className="text-[10px] font-medium text-[#9CA3AF] uppercase">{t("rydeApp.suggestedReplies")}</p>
          {suggestions.map((s, i) => (
            <button
              key={`${s}-${i}`}
              onClick={() => handleSuggestion(s)}
              className="w-full text-left rounded-xl bg-white border border-gray-200 px-4 py-2.5 text-sm text-[#111827] hover:border-[#E84360]/40 hover:bg-[#FDF1F3] active:scale-[0.99] transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 bg-white border-t border-gray-100">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("rydeApp.typeMessage")}
            className="flex-1 rounded-full bg-[#F3F4F6] px-4 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#E84360]/20"
          />
          <button
            type="submit"
            disabled={!input.trim() || isTyping}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E84360] text-white disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
