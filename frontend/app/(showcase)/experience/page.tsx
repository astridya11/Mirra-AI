"use client";

import Link from "next/link";
import { useI18n } from "@/src/context/I18nContext";
import { PresenterPanel } from "@/src/components/showcase/ui";
import { DEMO_IDS, briefingFor } from "@/src/lib/demoBriefings";
import { partyHref } from "@/src/lib/demoLinks";

/** Ryde Experience: enter the realistic Passenger or Driver app (after the prototype /experience page). */
export default function ExperiencePage() {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const roles = [
    {
      party: "passenger" as const,
      icon: "🧍",
      label: zh ? "乘客体验" : "Passenger Experience",
      sub: zh ? "以乘客身份查看行程，并私下咨询 MIRRA。" : "See the trip as the rider and ask MIRRA privately.",
    },
    {
      party: "driver" as const,
      icon: "🚘",
      label: zh ? "司机体验" : "Driver Experience",
      sub: zh ? "以司机身份查看行程，回应纠纷或提交清洁费索赔。" : "See the trip as the driver, respond to disputes or file a cleaning-fee claim.",
    },
  ];
  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-8 py-10">
      <div className="flex flex-col xl:flex-row xl:items-start gap-6">
        <div className="flex-1 min-w-0 max-w-3xl mx-auto text-center">
          <h1 className="text-4xl font-extrabold text-ink">{zh ? "Ryde 体验" : "Ryde Experience"}</h1>
          <p className="text-muted mt-2">
            {zh ? "选择一方，进入真实的 Ryde 应用界面。" : "Pick a side and step into the real Ryde app."}
          </p>
          <div className="grid sm:grid-cols-2 gap-6 mt-10 text-left">
            {roles.map((r) => (
              <div key={r.party} className="bg-white rounded-2xl border border-line p-7 shadow-sm" data-experience={r.party}>
                <div className="text-4xl">{r.icon}</div>
                <p className="font-bold text-ink mt-3 text-lg">{r.label}</p>
                <p className="text-xs text-muted mt-1">{r.sub}</p>
                <div className="mt-5 space-y-2">
                  {DEMO_IDS.map((id) => {
                    const d = briefingFor(id, locale)!;
                    return (
                      <a
                        key={id}
                        href={partyHref(id, r.party, `experience-${id}`)}
                        className="flex items-center justify-between rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink transition hover:-translate-y-0.5 hover:border-mirra/40"
                      >
                        <span>
                          {d.icon} {d.title}
                        </span>
                        <span className="text-mirra">→</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-6">
            {zh
              ? "同一场景的乘客与司机共用一个体验会话：私人 MIRRA 对话保持私密，正式投诉会同步给双方。"
              : "Passenger and driver share one experience session per scenario: private MIRRA chats stay private, formal complaints reach both sides."}
          </p>
          <p className="text-xs text-muted mt-2">
            {zh ? "也可以试用带登录的 " : "You can also try the signed-in "}
            <Link href="/ryde" className="text-mirra font-semibold hover:underline">
              {zh ? "Ryde 乘客应用（RydeHELP）" : "Ryde rider app (RydeHELP)"}
            </Link>
            .
          </p>
        </div>
        <PresenterPanel
          className="w-full xl:w-[320px] shrink-0 xl:sticky xl:top-24"
          stage={zh ? "Ryde 体验" : "Ryde Experience"}
          say={
            zh
              ? "这是乘客和司机日常看到的 Ryde 应用。MIRRA 就在应用内，随时私下提供帮助。"
              : "This is the Ryde app riders and drivers use every day. MIRRA lives inside it, ready to help privately."
          }
          watch={zh ? "MIRRA AI 按钮位于应用顶部栏。" : "The MIRRA AI button sits in the app bar."}
          next={zh ? "打开乘客体验。" : "Open the Passenger Experience."}
        />
      </div>
    </div>
  );
}
