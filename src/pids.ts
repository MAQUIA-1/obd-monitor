import type { DashboardValues } from "./types";

export function emptyValues(): DashboardValues {
  return {
    speedKph: null,
    rpm: null,
    batteryCurrentA: null,
    gear: null,
    steeringAngleDeg: null,
    fuelPct: null,
    batterySocPct: null,
    coolantTempC: null,
    controlVoltageV: null,
    outsideTempC: null,
    batteryVoltageV: null,
    updatedAt: null,
  };
}

type CanFrame = {
  header: string | null;
  bytes: number[];
};

export function parseStandardResponse(response: string, pid: string, responseHeader?: string): number | null {
  const bytes = extractSingleFrameBytes(response, responseHeader);
  if (bytes.length < 3) return null;

  const mode = bytes[1];
  const responsePid = bytes[2];
  if (mode !== 0x41 || responsePid !== Number.parseInt(pid, 16)) return null;

  const a = bytes[3] ?? 0;
  const b = bytes[4] ?? 0;

  switch (pid.toUpperCase()) {
    case "0C":
      return ((a * 256) + b) / 4;
    case "0D":
      return a;
    case "05":
      return a - 40;
    case "2F":
      return (a * 100) / 255;
    case "42":
      return ((a * 256) + b) / 1000;
    case "46":
      return a - 40;
    default:
      return null;
  }
}

export function parseBms2101(response: string) {
  const payload = extractIsoTpPayload(response);
  if (payload.length < 20 || payload[0] !== 0x61 || payload[1] !== 0x01) {
    return null;
  }

  return {
    batteryCurrentA: signed16(payload[5], payload[6]) / 10,
    batterySocPct: payload[6] / 2,
    batteryVoltageV: unsigned16(payload[14], payload[15]) / 10,
  };
}

export function parseSteering7d4_2101(response: string) {
  const payload = extractIsoTpPayload(response);
  if (payload.length < 7 || payload[0] !== 0x61 || payload[1] !== 0x01) {
    return null;
  }

  return signed16(payload[5], payload[6]) / 10;
}

export function parseGear7e1_21a0(response: string): string | null {
  const payload = extractIsoTpPayload(response);
  if (payload.length < 23 || payload[0] !== 0x61 || payload[1] !== 0xa0) {
    return null;
  }

  switch (payload[22]) {
    case 0x0c:
      return "M";
    case 0x0b:
      return "P";
    case 0x0a:
      return "R";
    case 0x09:
      return "N";
    case 0x08:
      return "D";
    default:
      return null;
  }
}

export function extractIsoTpPayload(response: string): number[] {
  const frames = extractCanPayloadFrames(response);
  const payload: number[] = [];
  let expectedLength: number | null = null;

  for (const frame of frames) {
    const pci = frame[0];
    const frameType = pci >> 4;

    if (frameType === 0x0) {
      expectedLength = pci & 0x0f;
      payload.push(...frame.slice(1));
    } else if (frameType === 0x1) {
      expectedLength = frame[1];
      payload.push(...frame.slice(2));
    } else if (frameType === 0x2) {
      payload.push(...frame.slice(1));
    } else {
      payload.push(...frame);
    }
  }

  return expectedLength == null ? payload : payload.slice(0, expectedLength);
}

function extractSingleFrameBytes(response: string, responseHeader?: string): number[] {
  const frames = extractCanFrames(response)
    .filter((frame) => !responseHeader || frame.header === responseHeader.toUpperCase())
    .map((frame) => frame.bytes);

  for (const first of frames) {
    if (first.length === 0) continue;

    const pci = first[0];
    if ((pci >> 4) === 0x0) {
      return first.slice(0, (pci & 0x0f) + 1);
    }
    return first;
  }

  return [];
}

function extractCanPayloadFrames(response: string): number[][] {
  return extractCanFrames(response).map((frame) => frame.bytes);
}

function extractCanFrames(response: string): CanFrame[] {
  return response
    .split(/[\r\n>]+/)
    .map((line) => line.replace(/\s+/g, "").toUpperCase())
    .filter((line) => /^[0-9A-F]{8,}$/.test(line))
    .map((line) => {
      const header = line.length >= 6 ? line.slice(0, 3) : null;
      const payload = header ? line.slice(3) : line;
      return { header, bytes: hexToBytes(payload) };
    })
    .filter((frame) => frame.bytes.length > 0);
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function signed16(hi: number, lo: number): number {
  const value = unsigned16(hi, lo);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function unsigned16(hi: number, lo: number): number {
  return ((hi & 0xff) << 8) | (lo & 0xff);
}
