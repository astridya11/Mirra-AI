/**
 * Localized demo content: English source data (scenarios.ts) + curated Chinese overlays.
 * Pure functions of the locale — the underlying demo/session data is never changed.
 */

import { APPS, DEMOS, GUIDE, type AppFixture, type Demo, type GuideStage, type StageNote } from "@/src/demo/scenarios";
import { overlay, type Locale } from "./index";
import { APPS_ZH, DEMOS_ZH, GUIDE_ZH } from "./content.zh-CN";

const zh = (l: Locale) => l === "zh-CN";

export const demosFor = (l: Locale): Demo[] => (zh(l) ? DEMOS.map((d) => overlay(d, DEMOS_ZH[d.n])) : DEMOS);

export const demoFor = (n: string, l: Locale): Demo | undefined => demosFor(l).find((d) => String(d.n) === n);

export function guideFor(key: string, l: Locale): Record<GuideStage, StageNote> {
  const base = GUIDE[key];
  if (!zh(l)) return base;
  const patch = (GUIDE_ZH[key] ?? {}) as Partial<Record<GuideStage, StageNote>>;
  // The missing-evidence path reuses Demo 3's opening stages.
  const opening = key === "3-missing" ? (GUIDE_ZH["3"] as Partial<Record<GuideStage, StageNote>>) : {};
  return overlay(base, { TRIP: opening.TRIP, PRIVATE: opening.PRIVATE, ...patch });
}

/** App fixture with localized labels (times, fare-line labels, claim title). Facts unchanged. */
export function appFor(app: AppFixture, l: Locale): AppFixture {
  if (!zh(l)) return app;
  const key = Object.keys(APPS).find((k) => APPS[k] === app) ?? app.demoId;
  return overlay(app, APPS_ZH[key]);
}
