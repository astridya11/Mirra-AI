"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/src/context/I18nContext";
import type { DemoEvidence } from "@/src/types/session";

interface EvidenceIntakeProps {
  evidence?: DemoEvidence;
  frozen: boolean;
  /** Field-level patch, merged into the latest stored evidence (rejected once frozen). */
  onChange: (patch: DemoEvidence) => void;
  onSubmit: () => void;
  onSkip: () => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function EvidenceIntake({
  evidence,
  frozen,
  onChange,
  onSubmit,
  onSkip,
}: EvidenceIntakeProps) {
  const { locale } = useI18n();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);

  const hasPhoto = !!evidence?.photoDataUrl;
  const hasReceipt = !!evidence?.receiptDataUrl;
  const canSubmit = hasPhoto || hasReceipt;

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoLoading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      onChange({
        photoDataUrl: dataUrl,
        photoName: file.name,
        skipped: false,
      });
    } catch {
      // ignore
    } finally {
      setPhotoLoading(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const handleReceiptSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptLoading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      onChange({
        receiptDataUrl: dataUrl,
        receiptName: file.name,
        skipped: false,
      });
    } catch {
      // ignore
    } finally {
      setReceiptLoading(false);
      if (receiptInputRef.current) receiptInputRef.current.value = "";
    }
  };

  const handleRemovePhoto = () => {
    onChange({ photoDataUrl: undefined, photoName: undefined });
  };

  const handleRemoveReceipt = () => {
    onChange({ receiptDataUrl: undefined, receiptName: undefined });
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Scrollable evidence; actions stay pinned at the bottom of the phone */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-3 py-3 space-y-3">
      <p className="text-xs text-muted leading-relaxed">
        {locale === "zh"
          ? "请提供清洁费索赔的证据。照片和收据将帮助 MIRRA 验证您的索赔。"
          : "Please provide evidence for your cleaning-fee claim. A photo and receipt help MIRRA verify your claim."}
      </p>

      {/* Photo */}
      <div className="rounded-2xl border border-line bg-white p-3 space-y-2 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#111827]">
            {locale === "zh" ? "清洁照片" : "Cleaning Photo"}
          </p>
          {hasPhoto && !frozen && (
            <button
              onClick={handleRemovePhoto}
              className="text-xs text-[#E84360] hover:underline"
            >
              {locale === "zh" ? "移除" : "Remove"}
            </button>
          )}
        </div>

        {hasPhoto ? (
          <div className="rounded-lg border border-gray-100 overflow-hidden">
            <img
              src={evidence!.photoDataUrl}
              alt="Cleaning evidence"
              className="w-full h-24 object-cover"
            />
            <p className="px-3 py-2 text-[10px] text-[#6B7280] truncate">
              {evidence!.photoName}
            </p>
          </div>
        ) : (
          <div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoSelect}
              disabled={frozen || photoLoading}
            />
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={frozen || photoLoading}
              className="w-full rounded-lg border-2 border-dashed border-gray-200 py-6 text-sm text-[#6B7280] hover:border-[#E84360]/30 hover:text-[#E84360] transition-colors disabled:opacity-40"
            >
              {photoLoading
                ? locale === "zh"
                  ? "处理中..."
                  : "Processing..."
                : locale === "zh"
                ? "上传照片"
                : "Upload Photo"}
            </button>
          </div>
        )}
      </div>

      {/* Receipt */}
      <div className="rounded-2xl border border-line bg-white p-3 space-y-2 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#111827]">
            {locale === "zh" ? "清洁收据" : "Cleaning Receipt"}
          </p>
          {hasReceipt && !frozen && (
            <button
              onClick={handleRemoveReceipt}
              className="text-xs text-[#E84360] hover:underline"
            >
              {locale === "zh" ? "移除" : "Remove"}
            </button>
          )}
        </div>

        {hasReceipt ? (
          <div className="rounded-lg border border-gray-100 overflow-hidden">
            <img
              src={evidence!.receiptDataUrl}
              alt="Receipt evidence"
              className="w-full h-24 object-cover"
            />
            <p className="px-3 py-2 text-[10px] text-[#6B7280] truncate">
              {evidence!.receiptName}
            </p>
          </div>
        ) : (
          <div>
            <input
              ref={receiptInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleReceiptSelect}
              disabled={frozen || receiptLoading}
            />
            <button
              onClick={() => receiptInputRef.current?.click()}
              disabled={frozen || receiptLoading}
              className="w-full rounded-lg border-2 border-dashed border-gray-200 py-6 text-sm text-[#6B7280] hover:border-[#E84360]/30 hover:text-[#E84360] transition-colors disabled:opacity-40"
            >
              {receiptLoading
                ? locale === "zh"
                  ? "处理中..."
                  : "Processing..."
                : locale === "zh"
                ? "上传收据"
                : "Upload Receipt"}
            </button>
          </div>
        )}
      </div>

      </div>

      {/* Actions */}
      <div className="shrink-0 border-t border-line bg-white p-3 space-y-2">
        <button
          onClick={onSubmit}
          disabled={!canSubmit || frozen}
          className="w-full rounded-xl bg-[#E84360] px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-[#DE3557] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
        >
          {locale === "zh" ? "提交索赔" : "Submit Claim"}
        </button>
        <button
          onClick={onSkip}
          disabled={frozen}
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-[#6B7280] hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {locale === "zh" ? "无证据继续" : "Continue without evidence"}
        </button>
      {frozen && (
        <p className="text-xs text-center text-[#9CA3AF]">
          {locale === "zh" ? "证据已冻结 — 仲裁已开始" : "Evidence frozen — tribunal has started"}
        </p>
      )}
      </div>
    </div>
  );
}
