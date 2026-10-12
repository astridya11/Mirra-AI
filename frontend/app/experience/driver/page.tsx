import { PartyTab } from "@/src/components/mobile/PartyTab";

// Free-play preview: Demo 2 / DISP-002 context on its own session.
export default function DriverExperience() {
  return <PartyTab party="driver" demoId="2" sessionId="preview" backHref="/experience" />;
}
