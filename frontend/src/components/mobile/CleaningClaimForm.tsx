"use client";

import { useRef, useState } from "react";
import { claimFiles, fileClaim } from "@/src/demo/live";
import type { AppFixture } from "@/src/demo/scenarios";
import type { Action, PartyView, UploadKind } from "@/src/demo/session";
import { useI18n } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";

const SLOTS: { kind: UploadKind; title: MessageKey; button: MessageKey; sample: string; why: MessageKey; uploaded: MessageKey }[] = [
  { kind: "photo", title: "claim.photo", button: "claim.uploadPhoto", sample: "cleaning-photo.jpg", why: "claim.photoWhy", uploaded: "claim.photoUploaded" },
  { kind: "receipt", title: "claim.receipt", button: "claim.uploadReceipt", sample: "cleaning-receipt.jpg", why: "claim.receiptWhy", uploaded: "claim.receiptUploaded" },
];

/**
 * Evidence collection for a cleaning-fee claim. The shared session records file names; the real
 * files stay in this tab and are sent to the backend (createDispute, base64) when the claim is filed.
 * Demo samples have no real file, so they keep the claim in offline fixture mode.
 * Nothing is analysed here: forensic checks run only after the claim proceeds and evidence freezes.
 */
export function CleaningClaimForm({
  app,
  view,
  dispatch,
  onClose,
}: {
  app: AppFixture;
  view: PartyView;
  dispatch: (a: Action) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();
  const [previews, setPreviews] = useState<Partial<Record<UploadKind, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Partial<Record<UploadKind, HTMLInputElement | null>>>({});
  const uploads = view.uploads ?? { photo: null, receipt: null };
  const both = !!uploads.photo && !!uploads.receipt;

  const upload = (kind: UploadKind, name: string, file?: File) => {
    if (file) claimFiles[kind] = file;
    else delete claimFiles[kind];
    dispatch({ type: "uploadEvidence", party: view.party, kind, name });
  };
  const submit = async () => {
    // Live only when every uploaded item is a real file in this tab (or nothing was uploaded).
    const realFiles = (!uploads.photo || !!claimFiles.photo) && (!uploads.receipt || !!claimFiles.receipt);
    setBusy(true);
    await fileClaim(app, view.party, dispatch, claimFiles, realFiles);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-white animate-slide-up" role="dialog" aria-label={t("claim.title")}>
      <div className="flex items-center justify-between px-4 h-11 border-b border-line shrink-0">
        <p className="text-sm font-bold text-ink">{t("claim.title")}</p>
        <button onClick={onClose} className="text-muted text-lg leading-none px-1" aria-label={t("claim.close")}>
          ✕
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar p-4 space-y-3">
        <p className="text-xs text-body">{t("claim.intro")}</p>
        {SLOTS.map((s) => {
          const name = uploads[s.kind];
          return (
            <section key={s.kind} className="rounded-xl border border-line p-3 space-y-2">
              <p className="text-[10px] font-bold tracking-widest text-muted uppercase">{t(s.title)}</p>
              {name ? (
                <div className="flex items-center gap-2">
                  {previews[s.kind] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local object-URL preview
                    <img src={previews[s.kind]} alt="" className="w-10 h-10 rounded-lg object-cover border border-line" />
                  ) : (
                    <span className="w-10 h-10 rounded-lg bg-surface border border-line flex items-center justify-center text-lg">{s.kind === "photo" ? "📷" : "🧾"}</span>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ok">{t(s.uploaded)}</p>
                    <p className="text-[10px] text-muted truncate">{name}</p>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => inputs.current[s.kind]?.click()}
                    className="w-full rounded-lg border-2 border-dashed border-mirra/40 text-mirra text-xs font-semibold py-2.5"
                  >
                    {t(s.button)}
                  </button>
                  <button onClick={() => upload(s.kind, s.sample)} className="w-full text-[10px] text-muted underline">
                    {t("claim.useSample")}
                  </button>
                  <input
                    ref={(el) => {
                      inputs.current[s.kind] = el;
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      if (!file.type.startsWith("image/")) {
                        setError(t("claim.imageOnly"));
                        return;
                      }
                      setError(null);
                      setPreviews((p) => ({ ...p, [s.kind]: URL.createObjectURL(file) }));
                      upload(s.kind, file.name, file);
                    }}
                  />
                </>
              )}
              <p className="text-[10px] text-muted">{t(s.why)}</p>
            </section>
          );
        })}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        <p className="text-[10px] text-muted">{t("claim.disclaimer")}</p>
      </div>
      <div className="shrink-0 border-t border-line p-3 space-y-2">
        <button onClick={submit} disabled={!both || busy} className="w-full rounded-xl bg-mirra text-white text-xs font-semibold py-2.5 disabled:opacity-40">
          {busy ? t("claim.submitting") : t("claim.continueWith")}
        </button>
        {!both && (
          <button onClick={submit} disabled={busy} className="w-full text-xs text-muted underline disabled:opacity-40">
            {t("claim.continueWithout")}
          </button>
        )}
      </div>
    </div>
  );
}
