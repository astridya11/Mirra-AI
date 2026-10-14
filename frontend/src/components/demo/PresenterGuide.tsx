"use client";

import { useTranslation } from "@/src/hooks/useTranslation";

export interface PresenterStep {
  say: string;
  watch: string;
  proves: string;
  expected: string;
  next: string;
}

interface PresenterGuideProps {
  step: PresenterStep;
}

export default function PresenterGuide({ step }: PresenterGuideProps) {
  const t = useTranslation();

  return (
    <div className="rounded-xl border border-[#0D9488]/20 bg-[#F0FDFA] p-4 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#0D9488]">
        {t("presenter.title")}
      </p>

      <div className="space-y-2">
        <GuideBlock label={t("presenter.say")} text={step.say} color="text-[#111827]" />
        <GuideBlock label={t("presenter.watch")} text={step.watch} color="text-[#6B7280]" />
        <GuideBlock label={t("presenter.proves")} text={step.proves} color="text-[#0D9488]" />
        <GuideBlock label={t("presenter.expected")} text={step.expected} color="text-[#6B7280]" />
        <GuideBlock label={t("presenter.next")} text={step.next} color="text-[#E84360]" />
      </div>
    </div>
  );
}

function GuideBlock({ label, text, color }: { label: string; text: string; color: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">{label}</p>
      <p className={`text-xs leading-relaxed ${color}`}>{text}</p>
    </div>
  );
}
