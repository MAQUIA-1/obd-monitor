import { parseBms2101, parseGear7e1_21a0, parseStandardResponse, parseSteering7d4_2101 } from "./pids";
import type { PollResult } from "./types";

const SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
const NOTIFY_UUID = "0000fff1-0000-1000-8000-00805f9b34fb";
const WRITE_UUID = "0000fff2-0000-1000-8000-00805f9b34fb";

export class ObdClient {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxBuffer = "";
  private pending: ((value: string) => void) | null = null;
  private currentHeader: string | null = null;
  private rawListeners: ((payload: string) => void)[] = [];
  private disconnectedListeners: (() => void)[] = [];

  on(type: "raw", listener: (payload: string) => void): void;
  on(type: "disconnected", listener: () => void): void;
  on(type: "raw" | "disconnected", listener: ((payload: string) => void) | (() => void)) {
    if (type === "raw") {
      this.rawListeners.push(listener as (payload: string) => void);
    } else {
      this.disconnectedListeners.push(listener as () => void);
    }
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("이 브라우저는 Web Bluetooth를 지원하지 않습니다.");
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "OBD" }],
      optionalServices: [SERVICE_UUID],
    });

    this.device.addEventListener("gattserverdisconnected", () => {
      for (const listener of this.disconnectedListeners) listener();
    });

    this.server = await this.device.gatt?.connect() ?? null;
    if (!this.server) throw new Error("GATT 연결 실패");

    const service = await this.server.getPrimaryService(SERVICE_UUID);
    this.notifyChar = await service.getCharacteristic(NOTIFY_UUID);
    this.writeChar = await service.getCharacteristic(WRITE_UUID);

    this.notifyChar.addEventListener("characteristicvaluechanged", this.handleNotify);
    await this.notifyChar.startNotifications();

    await this.initializeElm();
  }

  disconnect() {
    this.device?.gatt?.disconnect();
  }

  async pollFast(): Promise<PollResult> {
    return {
      ...(await this.pollMotion()),
      ...(await this.pollSteering()),
      ...(await this.pollGear()),
      updatedAt: Date.now(),
    };
  }

  async pollMotion(): Promise<PollResult> {
    await this.setHeader(null);
    return {
      rpm: parseStandardResponse(await this.command("010C"), "0C"),
      speedKph: parseStandardResponse(await this.command("010D"), "0D"),
      updatedAt: Date.now(),
    };
  }

  async pollBms(): Promise<PollResult> {
    await this.setHeader("7E4");
    return {
      ...parseBms2101(await this.command("2101", 1200)),
      updatedAt: Date.now(),
    };
  }

  async pollSteering(): Promise<PollResult> {
    await this.setHeader("7D4");
    return {
      steeringAngleDeg: parseSteering7d4_2101(await this.command("2101", 900)),
      updatedAt: Date.now(),
    };
  }

  async pollGear(): Promise<PollResult> {
    await this.setHeader("7E1");
    return {
      gear: parseGear7e1_21a0(await this.command("21A0", 900)),
      updatedAt: Date.now(),
    };
  }

  async pollSlow(): Promise<PollResult> {
    return {
      ...(await this.pollCoolant()),
      ...(await this.pollFuel()),
      ...(await this.pollControlVoltage()),
      ...(await this.pollOutsideTemp()),
      updatedAt: Date.now(),
    };
  }

  async pollCoolant(): Promise<PollResult> {
    await this.setHeader(null);
    return {
      coolantTempC: parseStandardResponse(await this.command("0105"), "05"),
      updatedAt: Date.now(),
    };
  }

  async pollFuel(): Promise<PollResult> {
    await this.setHeader(null);
    return {
      fuelPct: parseStandardResponse(await this.command("012F"), "2F"),
      updatedAt: Date.now(),
    };
  }

  async pollControlVoltage(): Promise<PollResult> {
    await this.setHeader("7E0");
    return {
      controlVoltageV: parseStandardResponse(await this.command("0142"), "42", "7E8"),
      updatedAt: Date.now(),
    };
  }

  async pollOutsideTemp(): Promise<PollResult> {
    await this.setHeader("7E0");
    return {
      outsideTempC: parseStandardResponse(await this.command("0146"), "46", "7E8"),
      updatedAt: Date.now(),
    };
  }

  private async initializeElm() {
    for (const cmd of ["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP6", "ATAL"]) {
      await this.command(cmd, cmd === "ATZ" ? 1400 : 600);
    }
  }

  private async setHeader(header: string | null) {
    if (this.currentHeader === header) return;

    if (header) {
      await this.command(`ATSH${header}`, 300);
    } else {
      await this.command("ATSH7DF", 300);
    }
    this.currentHeader = header;
  }

  private async command(command: string, timeoutMs = 800): Promise<string> {
    if (!this.writeChar) throw new Error("OBD write characteristic이 준비되지 않았습니다.");
    if (this.pending) throw new Error("이전 OBD 명령이 아직 완료되지 않았습니다.");

    this.rxBuffer = "";
    const responsePromise = new Promise<string>((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending = null;
        resolve(this.rxBuffer);
      }, timeoutMs);

      this.pending = (value) => {
        window.clearTimeout(timer);
        this.pending = null;
        resolve(value);
      };
    });

    await this.writeChar.writeValueWithoutResponse(new TextEncoder().encode(`${command}\r`));
    return responsePromise;
  }

  private handleNotify = (event: Event) => {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    if (!char.value) return;
    const text = new TextDecoder("ascii").decode(char.value);
    this.rxBuffer += text;
    for (const listener of this.rawListeners) listener(text);

    if (this.rxBuffer.includes(">")) {
      this.pending?.(this.rxBuffer);
    }
  };
}
