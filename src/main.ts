import "./style.css";
import { nextDemoValues, resetDemo } from "./demo";
import { ObdClient } from "./obd";
import { emptyValues } from "./pids";
import type { ConnectionState, DashboardValues, PollResult } from "./types";

const values = emptyValues();
const FAST_POLL_MS = 300;
const MEDIUM_POLL_MS = 1000;
const BMS_POLL_MS = 1000;
const SLOW_POLL_MS = 10000;
const VEHICLE_WIDTH_MM = 1865;
const VEHICLE_LENGTH_MM = 4855;
const WHEELBASE_MM = 2805;
const FRONT_TRACK_MM = 1614;
const REAR_TRACK_MM = 1621;
const FRONT_OVERHANG_MM = 965;
const STEERING_RATIO = 14.3;
const MAX_ROAD_WHEEL_DEG = 38;
const FRONT_AXLE_Y_MM = FRONT_OVERHANG_MM;
const REAR_AXLE_Y_MM = FRONT_AXLE_Y_MM + WHEELBASE_MM;
const PATH_DISTANCE_MM = 2600;

let state: ConnectionState = "idle";
let obd: ObdClient | null = null;
let demoTimer: number | null = null;
let pollLoopToken = 0;
let lastError = "";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <main class="shell">
    <section class="main-grid">
      <div class="gauge speed">
        <div class="label">속도</div>
        <div class="value-wrap"><div class="value" data-value="speedKph">--</div><div class="unit">km/h</div></div>
      </div>
      <div class="gauge gear">
        <div class="label">기어</div>
        <div class="value-wrap"><div class="value gear-value" data-value="gear">--</div></div>
      </div>
      <div class="gauge">
        <div class="label">RPM</div>
        <div class="value-wrap"><div class="value" data-value="rpm">--</div><div class="unit">rpm</div></div>
      </div>
      <div class="gauge battery-current">
        <div class="label">배터리 전류</div>
        <div class="value-wrap"><div class="value" data-value="batteryCurrentA">--</div><div class="unit">A</div></div>
      </div>
      <div class="steering-row">
        <div class="gauge steer">
          <div class="label">조향</div>
          <div class="steering-display">
            <div class="wheel-visual" data-steering-visual>
              <div class="wheel-paths forward">
                <svg viewBox="0 0 ${VEHICLE_WIDTH_MM} ${VEHICLE_LENGTH_MM}" preserveAspectRatio="none" aria-hidden="true">
                  <path class="wheel-path" data-steering-path="forward-left" />
                  <path class="wheel-path" data-steering-path="forward-right" />
                </svg>
              </div>
              <div class="wheel-paths reverse">
                <svg viewBox="0 0 ${VEHICLE_WIDTH_MM} ${VEHICLE_LENGTH_MM}" preserveAspectRatio="none" aria-hidden="true">
                  <path class="wheel-path" data-steering-path="reverse-left" />
                  <path class="wheel-path" data-steering-path="reverse-right" />
                </svg>
              </div>
              <div class="wheel-axle front">
                <div class="wheel tire front-left"></div>
                <div class="wheel tire front-right"></div>
              </div>
              <div class="wheel-axle rear">
                <div class="wheel tire"></div>
                <div class="wheel tire"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="panel steering-metrics">
          <div class="row"><span>냉각수온</span><strong data-value="coolantTempC">--</strong><em>°C</em></div>
          <div class="row"><span>HV 전압</span><strong data-value="batteryVoltageV">--</strong><em>V</em></div>
          <div class="row"><span>12V 전압</span><strong data-value="controlVoltageV">--</strong><em>V</em></div>
          <div class="metric-bars">
            <div class="row row-with-bar">
              <span>연료</span><strong data-value="fuelPct">--</strong><em>%</em>
              <div class="meter"><div class="meter-fill fuel" data-meter="fuelPct"></div></div>
            </div>
            <div class="row row-with-bar">
              <span>배터리</span><strong data-value="batterySocPct">--</strong><em>%</em>
              <div class="meter"><div class="meter-fill battery" data-meter="batterySocPct"></div></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="support-grid">
      <div class="panel">
        <div class="row"><span>외기온도</span><strong data-value="outsideTempC">--</strong><em>°C</em></div>
      </div>
    </section>

    <section class="statusline">
      <span id="statusDot" class="dot"></span>
      <span id="statusText">대기 중</span>
    </section>

    <section class="topbar">
      <div>
        <h1>OBD Monitor</h1>
        <div id="subtitleText" class="subtitle">No data</div>
      </div>
      <div class="actions">
        <button id="demoBtn">데모</button>
        <button id="themeBtn">라이트</button>
        <button id="connectBtn" class="primary">연결</button>
      </div>
    </section>
  </main>
`;

const connectBtn = mustGet<HTMLButtonElement>("connectBtn");
const demoBtn = mustGet<HTMLButtonElement>("demoBtn");
const themeBtn = mustGet<HTMLButtonElement>("themeBtn");
const statusText = mustGet<HTMLSpanElement>("statusText");
const statusDot = mustGet<HTMLSpanElement>("statusDot");
const subtitleText = mustGet<HTMLDivElement>("subtitleText");

let theme: "dark" | "light" = "dark";
document.documentElement.dataset.theme = theme;

connectBtn.addEventListener("click", () => {
  if (state === "connected" || state === "connecting") {
    stopAll();
    setState("idle");
    render();
    return;
  }
  void connectObd();
});

demoBtn.addEventListener("click", () => {
  if (state === "demo") {
    stopAll();
    Object.assign(values, emptyValues());
    setState("idle");
    render();
    return;
  }
  stopAll();
  resetDemo();
  setState("demo");
  demoTimer = window.setInterval(() => {
    mergeValues(nextDemoValues());
    render();
  }, 180);
});

themeBtn.addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  themeBtn.textContent = theme === "dark" ? "라이트" : "다크";
});

render();

async function connectObd() {
  stopAll();
  setState("connecting");
  render();

  try {
    obd = new ObdClient();
    obd.on("disconnected", () => {
      stopAll();
      setState("idle");
      render();
    });

    await obd.connect();
    setState("connected");

    void runPollQueue(++pollLoopToken);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    stopAll();
    setState("error");
  } finally {
    render();
  }
}

async function runPollQueue(token: number) {
  if (!obd) return;

  const startedAt = Date.now();
  const pollTasks = [
    { interval: FAST_POLL_MS, dueAt: startedAt, run: () => obd?.pollFast() },
    { interval: MEDIUM_POLL_MS, dueAt: startedAt + MEDIUM_POLL_MS / 2, run: () => obd?.pollMedium() },
    { interval: BMS_POLL_MS, dueAt: startedAt, run: () => obd?.pollBms() },
    { interval: SLOW_POLL_MS, dueAt: startedAt, run: () => obd?.pollCoolant() },
    { interval: SLOW_POLL_MS, dueAt: startedAt + SLOW_POLL_MS / 4, run: () => obd?.pollFuel() },
    { interval: SLOW_POLL_MS, dueAt: startedAt + SLOW_POLL_MS / 2, run: () => obd?.pollControlVoltage() },
    { interval: SLOW_POLL_MS, dueAt: startedAt + SLOW_POLL_MS * 3 / 4, run: () => obd?.pollOutsideTemp() },
  ];

  while (obd && state === "connected" && token === pollLoopToken) {
    const now = Date.now();
    const task = pollTasks
      .filter((item) => now >= item.dueAt)
      .sort((a, b) => a.dueAt - b.dueAt)[0];

    if (task) {
      try {
        const update = await task.run();
        if (update) mergeValues(update);
        task.dueAt = Date.now() + task.interval;
        render();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        setState("error");
        render();
        break;
      }
    }

    await sleep(20);
  }
}

function mergeValues(update: PollResult) {
  Object.assign(values, update);
}

function stopAll() {
  pollLoopToken++;
  if (demoTimer) window.clearInterval(demoTimer);
  demoTimer = null;
  obd?.disconnect();
  obd = null;
}

function setState(next: ConnectionState) {
  state = next;
  connectBtn.textContent = state === "connected" || state === "connecting" ? "해제" : "연결";
  demoBtn.textContent = state === "demo" ? "중지" : "데모";
}

function render() {
  setText("speedKph", formatNumber(values.speedKph, 0));
  setText("rpm", formatNumber(values.rpm, 0));
  setText("batteryCurrentA", formatSigned(values.batteryCurrentA, 1));
  setText("gear", values.gear ?? "--");
  setSteeringVisual(values.steeringAngleDeg);
  setText("fuelPct", formatNumber(values.fuelPct, 0));
  setText("batterySocPct", formatNumber(values.batterySocPct, 0));
  setText("batteryVoltageV", formatNumber(values.batteryVoltageV, 1));
  setText("coolantTempC", formatNumber(values.coolantTempC, 0));
  setText("controlVoltageV", formatNumber(values.controlVoltageV, 3));
  setText("outsideTempC", formatNumber(values.outsideTempC, 0));
  setUpperWarning("coolantTempC", values.coolantTempC, 105);
  setRangeWarning("batteryVoltageV", values.batteryVoltageV, 240, 305);
  setRangeWarning("controlVoltageV", values.controlVoltageV, 13.2, 14.9);
  setMeter("fuelPct", values.fuelPct);
  setMeter("batterySocPct", values.batterySocPct);

  const currentEl = document.querySelector<HTMLElement>('[data-value="batteryCurrentA"]');
  currentEl?.classList.toggle("regen", (values.batteryCurrentA ?? 0) < 0);

  const status = statusForState(state);
  statusText.textContent = status;
  statusDot.className = `dot ${state}`;
  subtitleText.textContent = subtitleForState();
}

function statusForState(current: ConnectionState): string {
  switch (current) {
    case "idle":
      return "대기 중";
    case "connecting":
      return "연결 중";
    case "connected":
      return "OBD 연결됨";
    case "demo":
      return "데모 모드";
    case "error":
      return lastError || "오류";
  }
}

function subtitleForState() {
  if (!values.updatedAt) return "No samples";

  const ageSeconds = Math.max(0, Math.floor((Date.now() - values.updatedAt) / 1000));
  return ageSeconds < 2 ? "Live" : `Last sample ${ageSeconds}s ago`;
}

function setText(key: keyof DashboardValues, text: string) {
  for (const el of document.querySelectorAll(`[data-value="${key}"]`)) {
    el.textContent = text;
  }
}

function setRangeWarning(key: keyof DashboardValues, value: number | null, min: number, max: number) {
  const isWarning = value != null && !Number.isNaN(value) && (value < min || value > max);
  for (const el of document.querySelectorAll<HTMLElement>(`[data-value="${key}"]`)) {
    el.classList.toggle("range-warning", isWarning);
  }
}

function setUpperWarning(key: keyof DashboardValues, value: number | null, max: number) {
  const isWarning = value != null && !Number.isNaN(value) && value > max;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-value="${key}"]`)) {
    el.classList.toggle("range-warning", isWarning);
  }
}

function setMeter(key: keyof DashboardValues, value: number | null) {
  const percent = value == null || Number.isNaN(value) ? 0 : Math.max(0, Math.min(100, value));
  for (const el of document.querySelectorAll<HTMLElement>(`[data-meter="${key}"]`)) {
    el.style.setProperty("--meter-pct", `${percent}%`);
  }
}

function setSteeringVisual(value: number | null) {
  const wheelAngle = roadWheelAngleDeg(value);
  for (const el of document.querySelectorAll<HTMLElement>("[data-steering-visual]")) {
    el.style.setProperty("--wheel-angle", `${wheelAngle}deg`);
    el.dataset.gear = values.gear ?? "";
  }
  setSteeringPath("forward-left", buildWheelPath(wheelAngle, "forward", "left"));
  setSteeringPath("forward-right", buildWheelPath(wheelAngle, "forward", "right"));
  setSteeringPath("reverse-left", buildWheelPath(wheelAngle, "reverse", "left"));
  setSteeringPath("reverse-right", buildWheelPath(wheelAngle, "reverse", "right"));
}

function roadWheelAngleDeg(steeringWheelAngleDeg: number | null): number {
  if (steeringWheelAngleDeg == null || Number.isNaN(steeringWheelAngleDeg)) return 0;
  return Math.max(-MAX_ROAD_WHEEL_DEG, Math.min(MAX_ROAD_WHEEL_DEG, steeringWheelAngleDeg / STEERING_RATIO));
}

function setSteeringPath(name: string, path: string) {
  for (const el of document.querySelectorAll<SVGPathElement>(`[data-steering-path="${name}"]`)) {
    el.setAttribute("d", path);
  }
}

function buildWheelPath(wheelAngleDeg: number, direction: "forward" | "reverse", side: "left" | "right"): string {
  const isForward = direction === "forward";
  const trackMm = isForward ? FRONT_TRACK_MM : REAR_TRACK_MM;
  const axleY = isForward ? FRONT_AXLE_Y_MM : REAR_AXLE_Y_MM;
  const sideSign = side === "right" ? 1 : -1;
  const startX = VEHICLE_WIDTH_MM / 2 + sideSign * trackMm / 2;
  const startY = axleY;

  if (Math.abs(wheelAngleDeg) < 0.5) {
    const endY = startY + (isForward ? -PATH_DISTANCE_MM : PATH_DISTANCE_MM);
    return linePath([{ x: startX, y: startY }, { x: startX, y: endY }]);
  }

  const turnSign = wheelAngleDeg > 0 ? 1 : -1;
  const centerX = VEHICLE_WIDTH_MM / 2 + turnSign * WHEELBASE_MM / Math.tan(degToRad(Math.abs(wheelAngleDeg)));
  const centerY = REAR_AXLE_Y_MM;
  const radius = Math.hypot(startX - centerX, startY - centerY);
  const startAngle = Math.atan2(startY - centerY, startX - centerX);
  const travelSign = isForward ? turnSign : -turnSign;
  const angleSweep = Math.min(PATH_DISTANCE_MM / radius, 1.35);
  const points = Array.from({ length: 24 }, (_, index) => {
    const t = index / 23;
    const angle = startAngle + travelSign * angleSweep * t;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  });

  return linePath(points);
}

function linePath(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

function degToRad(deg: number): number {
  return deg * Math.PI / 180;
}

function formatNumber(value: number | null, digits: number) {
  if (value == null || Number.isNaN(value)) return "--";
  return value.toFixed(digits);
}

function formatSigned(value: number | null, digits: number) {
  if (value == null || Number.isNaN(value)) return "--";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}`;
}

function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
