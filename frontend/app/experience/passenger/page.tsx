import { PartyTab } from "@/src/components/mobile/PartyTab";

// Free-play preview: Demo 1 / DISP-001 context on its own session.
export default function PassengerExperience() {
  return <PartyTab party="passenger" demoId="1" sessionId="preview" backHref="/experience" />;
}
