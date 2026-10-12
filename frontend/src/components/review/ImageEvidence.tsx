"use client";

import { useEffect, useState } from "react";
import { backendUrl, getImageCheck, type ImageCheckResponse } from "@/src/lib/api";
import { enumLabel, useI18n } from "@/src/i18n";
import { RawText } from "@/src/i18n/RawText";

const STATUS_STYLE = {
  OK: "bg-green-50 text-green-700 border-green-200",
  FLAGGED: "bg-red-50 text-red-700 border-red-200",
  INCOMPLETE: "bg-amber-50 text-amber-800 border-amber-200",
} as const;

/**
 * Image evidence for Human Support: the uploaded photo, the backend's integrity checks
 * (EXIF time, photo location, recycled image, AI-generated) and the Judge's rendered verdict image.
 * Same data as the tribunal's "Image Analysis" / "Evidence Verdict" bubbles (GET /evidence/image-check).
 */
export function ImageEvidence({ caseId }: { caseId: string }) {
  const [res, setRes] = useState<ImageCheckResponse | null | undefined>(undefined);
  const [stamp, setStamp] = useState(0); // cache-buster so a re-rendered verdict image is never stale
  const { t } = useI18n();

  useEffect(() => {
    let alive = true;
    getImageCheck(caseId).then((r) => {
      if (!alive) return;
      setRes(r);
      setStamp(Date.now());
    });
    return () => {
      alive = false;
    };
  }, [caseId]);

  if (res === undefined) return null;
  const images = res?.images ?? [];

  return (
    <section className="mt-8 rounded-2xl border border-gray-200 bg-white shadow-sm p-6 md:p-8 space-y-4" aria-label={t("img.aria")}>
      <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
        <span className="w-2 h-6 bg-[#E84360] rounded-sm" />
        <h2 className="text-lg font-extrabold tracking-wide text-gray-900">{t("img.title")}</h2>
      </div>
      {images.length === 0 ? (
        <p className="text-sm text-gray-500">{t("img.none")}</p>
      ) : (
        images.map((img) => (
          <div key={img.image_id} className="grid gap-4 lg:grid-cols-[1fr_1fr_minmax(0,1fr)]">
            <Figure title={t("img.submitted")} src={backendUrl(img.image_url)} />
            {img.verdict_image_url ? (
              <Figure title={t("img.verdict")} src={`${backendUrl(img.verdict_image_url)}?t=${stamp}`} />
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">{t("img.noVerdict")}</div>
            )}
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-gray-500">{img.image_id}</span>
                <span className={`text-[11px] font-bold rounded border px-1.5 py-0.5 ${STATUS_STYLE[img.status]}`} title={img.status}>
                  {t(`img.status.${img.status}`)}
                </span>
              </div>
              {(img.classification || img.severity) && (
                <p className="font-semibold text-gray-900">
                  {[img.classification, img.severity].filter(Boolean).map((v) => enumLabel(t, v)).join(" · ")}
                </p>
              )}
              <ul className="space-y-1 text-gray-700">
                {img.photo_time && (
                  <li>
                    🕒 <RawText as="span" text={img.photo_time.text} />
                  </li>
                )}
                {img.photo_distance && (
                  <li>
                    📍 <RawText as="span" text={img.photo_distance.text} />
                  </li>
                )}
                <li>♻️ {img.recycled.matched ? t("img.recycled", { id: img.recycled.prior_case ?? "" }) : t("img.notRecycled")}</li>
                {img.ai_generated.flag != null && <li>🤖 {t(img.ai_generated.flag ? "img.aiGenerated" : "img.notAiGenerated")}</li>}
              </ul>
              <RawText text={img.summary} className="text-gray-600 border-t border-gray-100 pt-2" />
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function Figure({ title, src }: { title: string; src: string }) {
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</figcaption>
      <a href={src} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- backend evidence image */}
        <img src={src} alt={title} className="w-full max-h-72 object-contain rounded-xl border border-gray-200 bg-gray-50" />
      </a>
    </figure>
  );
}
