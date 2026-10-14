import type { DemoId, TripInfo, TripStatus } from "@/src/types/session";

export interface DemoScenario {
  id: DemoId;
  titleEn: string;
  titleZh: string;
  initialTripStatus: TripStatus;
  passengerInitialTextEn: string;
  passengerInitialTextZh: string;
  driverInitialTextEn: string;
  driverInitialTextZh: string;
  trip: TripInfo;
}

export const demoScenarios: Record<DemoId, DemoScenario> = {
  "1": {
    id: "1",
    titleEn: "Route Deviation",
    titleZh: "路线偏离",
    initialTripStatus: "completed",
    passengerInitialTextEn: "I think the driver took a longer route than necessary.",
    passengerInitialTextZh: "我觉得司机走了不必要的绕路。",
    driverInitialTextEn: "I followed the recommended route.",
    driverInitialTextZh: "我按照推荐路线行驶。",
    trip: {
      pickup: "Marina Bay Sands",
      dropoff: "Changi Airport T3",
      fare: "S$18.50",
      eta: "18 min",
      status: "completed",
      driverName: "Tan Ah Kow",
      passengerName: "Sarah Chen",
      vehicle: "Toyota Camry",
      licensePlate: "SGR1234A",
    },
  },
  "2": {
    id: "2",
    titleEn: "No-show Charge",
    titleZh: "未到场费用",
    initialTripStatus: "cancelled",
    passengerInitialTextEn: "Why was I charged a cancellation fee?",
    passengerInitialTextZh: "为什么我被收取了取消费？",
    driverInitialTextEn: "The rider hasn't arrived yet.",
    driverInitialTextZh: "乘客还没到。",
    trip: {
      pickup: "Tiong Bahru Plaza",
      dropoff: "VivoCity",
      fare: "S$5.00",
      eta: "13 min",
      status: "cancelled",
      driverName: "Lim Wei Ming",
      passengerName: "Michael Wong",
      vehicle: "Honda HR-V",
      licensePlate: "SGP 4521 M",
    },
  },
  "3": {
    id: "3",
    titleEn: "Cleaning Fee",
    titleZh: "清洁费",
    initialTripStatus: "completed",
    passengerInitialTextEn: "What is this extra charge for?",
    passengerInitialTextZh: "这笔额外费用是什么？",
    driverInitialTextEn: "The rider left a mess in the back seat.",
    driverInitialTextZh: "乘客在后座留下了污渍。",
    trip: {
      pickup: "Orchard",
      dropoff: "Bishan",
      fare: "S$24.50",
      eta: "25 min",
      status: "completed",
      driverName: "Suresh Kumar",
      passengerName: "Mei Tan",
      vehicle: "Hyundai Tucson",
      licensePlate: "SGY9012C",
    },
  },
};

export function getScenario(demoId: string): DemoScenario | undefined {
  return demoScenarios[demoId as DemoId];
}
