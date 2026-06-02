export type ConnectionState = "idle" | "connecting" | "connected" | "demo" | "error";

export type DashboardValues = {
  speedKph: number | null;
  rpm: number | null;
  batteryCurrentA: number | null;
  gear: string | null;
  steeringAngleDeg: number | null;
  fuelPct: number | null;
  batterySocPct: number | null;
  coolantTempC: number | null;
  controlVoltageV: number | null;
  outsideTempC: number | null;
  batteryVoltageV: number | null;
  updatedAt: number | null;
};

export type PollResult = Partial<DashboardValues>;
