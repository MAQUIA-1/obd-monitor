import type { PollResult } from "./types";

let startedAt = Date.now();

export function resetDemo() {
  startedAt = Date.now();
}

export function nextDemoValues(): PollResult {
  const t = (Date.now() - startedAt) / 1000;
  const speed = Math.max(0, Math.sin(t / 4) * 52 + 58 + Math.sin(t * 1.7) * 5);
  const rpm = speed < 2 ? 0 : 900 + Math.sin(t / 3) * 260 + speed * 18;
  const regenPhase = Math.sin(t / 2.5);

  return {
    speedKph: speed,
    rpm,
    batteryCurrentA: regenPhase > 0.35 ? -18 - regenPhase * 12 : 12 + Math.sin(t * 2) * 8,
    steeringAngleDeg: Math.sin(t / 1.7) * 28,
    batterySocPct: 52.5 + Math.sin(t / 30) * 0.4,
    batteryVoltageV: 273 + Math.sin(t / 8) * 2,
    fuelPct: 70.6,
    coolantTempC: 65 + Math.min(t / 10, 1) * 8,
    controlVoltageV: 14.78 + Math.sin(t / 9) * 0.08,
    outsideTempC: 22,
    gear: null,
    updatedAt: Date.now(),
  };
}
