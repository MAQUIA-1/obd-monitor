import "./style.css";
import { nextDemoValues, resetDemo } from "./demo";
import { ObdClient } from "./obd";
import { emptyValues } from "./pids";
import type { ConnectionState, DashboardValues, PollResult } from "./types";

const values = emptyValues();
const FAST_POLL_MS = 300;
const BMS_POLL_MS = 1000;
const SLOW_POLL_MS = 10000;

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
      <div class="gauge steer">
        <div class="label">핸들각</div>
        <div class="steering-display">
          <div class="steer-spacer"></div>
          <div class="steer-arrow" data-steering-arrow="left">←</div>
          <div class="steer-value-wrap"><div class="value" data-value="steeringAngleDeg">--</div><div class="unit">°</div></div>
          <div class="steer-arrow" data-steering-arrow="right">→</div>
          <div class="steer-spacer"></div>
        </div>
        <div class="steer-meter">
          <div class="meter-fill steer-meter-fill left" data-meter="steeringLeftPct"></div>
          <div class="steer-meter-center"></div>
          <div class="meter-fill steer-meter-fill right" data-meter="steeringRightPct"></div>
        </div>
      </div>
    </section>

    <section class="support-grid">
      <div class="panel">
        <div class="row row-with-bar">
          <span>연료</span><strong data-value="fuelPct">--</strong><em>%</em>
          <div class="meter"><div class="meter-fill fuel" data-meter="fuelPct"></div></div>
        </div>
        <div class="row row-with-bar">
          <span>배터리</span><strong data-value="batterySocPct">--</strong><em>%</em>
          <div class="meter"><div class="meter-fill battery" data-meter="batterySocPct"></div></div>
        </div>
      </div>
      <div class="panel">
        <div class="row"><span>냉각수온</span><strong data-value="coolantTempC">--</strong><em>°C</em></div>
        <div class="row"><span>HV 전압</span><strong data-value="batteryVoltageV">--</strong><em>V</em></div>
        <div class="row row-with-note"><span>12V 전압</span><strong data-value="controlVoltageV">--</strong><em>V</em><small>85-105°C · 260-290V · 13.5-14.8V</small></div>
      </div>
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
  const steering = formatSteeringParts(values.steeringAngleDeg);
  setText("steeringAngleDeg", steering.value);
  setSteeringArrows(steering.direction);
  setSteeringMeter(values.steeringAngleDeg);
  setText("fuelPct", formatNumber(values.fuelPct, 1));
  setText("batterySocPct", formatNumber(values.batterySocPct, 1));
  setText("batteryVoltageV", formatNumber(values.batteryVoltageV, 1));
  setText("coolantTempC", formatNumber(values.coolantTempC, 0));
  setText("controlVoltageV", formatNumber(values.controlVoltageV, 3));
  setText("outsideTempC", formatNumber(values.outsideTempC, 0));
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

function setSteeringArrows(direction: "left" | "right" | null) {
  for (const el of document.querySelectorAll<HTMLElement>("[data-steering-arrow]")) {
    el.classList.toggle("visible", el.dataset.steeringArrow === direction);
  }
}

function setMeter(key: keyof DashboardValues, value: number | null) {
  const percent = value == null || Number.isNaN(value) ? 0 : Math.max(0, Math.min(100, value));
  for (const el of document.querySelectorAll<HTMLElement>(`[data-meter="${key}"]`)) {
    el.style.setProperty("--meter-pct", `${percent}%`);
  }
}

function setSteeringMeter(value: number | null) {
  const maxAngle = 500;
  const leftPct = value == null || Number.isNaN(value) || value >= 0 ? 0 : Math.min(100, Math.abs(value) / maxAngle * 100);
  const rightPct = value == null || Number.isNaN(value) || value <= 0 ? 0 : Math.min(100, value / maxAngle * 100);

  for (const el of document.querySelectorAll<HTMLElement>('[data-meter="steeringLeftPct"]')) {
    el.style.setProperty("--meter-pct", `${leftPct}%`);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-meter="steeringRightPct"]')) {
    el.style.setProperty("--meter-pct", `${rightPct}%`);
  }
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

function formatSteeringParts(value: number | null): { value: string; direction: "left" | "right" | null } {
  if (value == null || Number.isNaN(value)) {
    return { value: "--", direction: null };
  }

  const abs = Math.abs(value);
  if (abs === 0) {
    return { value: "0", direction: null };
  }

  return {
    value: abs.toFixed(1),
    direction: value < 0 ? "left" : "right",
  };
}

function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
