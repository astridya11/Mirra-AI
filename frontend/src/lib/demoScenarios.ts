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
      dropoff: "Jewel Changi Airport",
      fare: "$24.50",
      eta: "18 min",
      status: "completed",
      driverName: "Mr. Tan",
      passengerName: "Alex",
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
      pickup: "Orchard Road",
      dropoff: "Tampines Mall",
      fare: "$5.00",
      eta: "12 min",
      status: "cancelled",
      driverName: "Ms. Lim",
      passengerName: "Sam",
      vehicle: "Honda Vezel",
      licensePlate: "SGX5678B",
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
      pickup: "Clarke Quay",
      dropoff: "Sentosa Cove",
      fare: "$18.00 + $100.00",
      eta: "22 min",
      status: "completed",
      driverName: "Mr. Kumar",
      passengerName: "Jordan",
      vehicle: "Hyundai Tucson",
      licensePlate: "SGY9012C",
    },
  },
};

export function getScenario(demoId: string): DemoScenario | undefined {
  return demoScenarios[demoId as DemoId];
}
