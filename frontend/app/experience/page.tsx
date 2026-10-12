"use client";

import Link from "next/link";
import { AppShell, PresenterPanel } from "@/src/components/showcase/ui";
import { useI18n } from "@/src/i18n";
import type { MessageKey } from "@/src/i18n/en";

const ROLES: { href: string; icon: string; label: MessageKey; sub: MessageKey }[] = [
  { href: "/experience/passenger", icon: "🧍", label: "exp.passenger", sub: "exp.passengerSub" },
  { href: "/experience/driver", icon: "🚘", label: "exp.driver", sub: "exp.driverSub" },
];

export default function ExperienceLanding() {
  const { t } = useI18n();
  return (
    <AppShell>
      <div className="flex flex-col xl:flex-row xl:items-start gap-6">
        <div className="flex-1 min-w-0 max-w-2xl mx-auto text-center">
          <h1 className="text-4xl font-extrabold text-ink">{t("exp.title")}</h1>
          <p className="text-muted mt-2">{t("exp.subtitle")}</p>
          <div className="grid sm:grid-cols-2 gap-6 mt-10">
            {ROLES.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className="bg-white rounded-2xl border border-line p-8 shadow-sm transition hover:-translate-y-0.5 hover:border-mirra/40"
              >
                <div className="text-4xl">{r.icon}</div>
                <p className="font-bold text-ink mt-3">{t(r.label)} →</p>
                <p className="text-xs text-muted mt-1">{t(r.sub)}</p>
              </Link>
            ))}
          </div>
          <p className="text-xs text-muted mt-6">{t("exp.privacy")}</p>
        </div>
        <PresenterPanel
          note={{
            stage: t("exp.presenter.stage"),
            say: t("exp.presenter.say"),
            watch: t("exp.presenter.watch"),
            next: t("exp.presenter.next"),
          }}
        />
      </div>
    </AppShell>
  );
}
