# Direct Bluetooth OBD Capture

This documents how to bypass the browser app and read the BLE OBD adapter directly from the laptop with BlueZ.

## Known Adapter

- Device name: `OBDII`
- Bluetooth address: `00:10:CC:4F:36:03`
- BLE service: `0000fff0-0000-1000-8000-00805f9b34fb`
- Notify characteristic: `0000fff1-0000-1000-8000-00805f9b34fb`
- Write characteristic: `0000fff2-0000-1000-8000-00805f9b34fb`

BlueZ object paths used during the successful capture:

```sh
CHAR_N=/org/bluez/hci0/dev_00_10_CC_4F_36_03/service0008/char0009
CHAR_W=/org/bluez/hci0/dev_00_10_CC_4F_36_03/service0008/char000c
```

If the adapter is rediscovered and BlueZ assigns different service/char suffixes, run `bluetoothctl`, connect, then inspect GATT attributes.

## Connect And Enable Notify

Disconnect the web app first. Only one client should use the adapter at a time.

```sh
bluetoothctl connect 00:10:CC:4F:36:03
```

Then enable notifications:

```text
bluetoothctl
menu gatt
select-attribute /org/bluez/hci0/dev_00_10_CC_4F_36_03/service0008/char0009
notify on
```

Keep this `bluetoothctl` session open while capturing. It makes the notify characteristic active. Quit it when finished:

```text
quit
```

## Write A Command

`bluetoothctl write` failed with `org.bluez.Error.NotSupported` on this adapter. `busctl WriteValue` works.

Example: send `ATZ\r`.

```sh
busctl call org.bluez \
  /org/bluez/hci0/dev_00_10_CC_4F_36_03/service0008/char000c \
  org.bluez.GattCharacteristic1 WriteValue \
  aya{sv} 4 0x41 0x54 0x5a 0x0d 0
```

The `aya{sv}` argument is:

- byte count
- one hex byte per command character
- final `0` for an empty options dictionary

## Read Latest Notify Value

```sh
busctl get-property org.bluez \
  /org/bluez/hci0/dev_00_10_CC_4F_36_03/service0008/char0009 \
  org.bluez.GattCharacteristic1 Value
```

The output is a D-Bus byte array. The first number after `ay` is the byte count; following numbers are byte values. Convert them to ASCII to see ELM output.

Polling immediately after each write is enough for short captures. D-Bus monitor was denied by policy during testing, so use polling instead.

## Minimal Python Capture Script

Run with Bluetooth access outside the sandbox if needed.

```python
import re
import subprocess
import time

CHAR_W = "/org/bluez/hci0/dev_00_10_CC_4F_36_03/service0008/char000c"
CHAR_N = "/org/bluez/hci0/dev_00_10_CC_4F_36_03/service0008/char0009"

def run(args, timeout=2):
    return subprocess.run(args, text=True, capture_output=True, timeout=timeout)

def write(cmd):
    data = (cmd + "\r").encode("ascii")
    args = [
        "busctl", "call", "org.bluez", CHAR_W,
        "org.bluez.GattCharacteristic1", "WriteValue",
        "aya{sv}", str(len(data)),
    ]
    args += [hex(byte) for byte in data]
    args += ["0"]
    result = run(args)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)

def read_value():
    result = run([
        "busctl", "get-property", "org.bluez", CHAR_N,
        "org.bluez.GattCharacteristic1", "Value",
    ])
    nums = [int(x) for x in re.findall(r"\b\d+\b", result.stdout)]
    if not nums:
        return ""
    length = nums[0]
    return bytes(nums[1:1 + length]).decode("latin1", "replace")

def query(cmd, polls=16, delay=0.06):
    write(cmd)
    chunks = []
    last = None
    for _ in range(polls):
        time.sleep(delay)
        value = read_value()
        if value and value != last:
            chunks.append(value)
            last = value
        if ">" in value:
            break
    return "".join(chunks)

for cmd in ["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP6", "ATAL"]:
    print(cmd, query(cmd))

print("TCM header", query("ATSH7E1"))
print("Gear packet", query("21A0"))
```

## Confirmed Gear Capture

TCM request:

```text
ATSH7E1
21A0
```

The response address is `7E9`. `21A0` returns an ISO-TP payload beginning with `61 A0`.

Confirmed selector mapping from live captures:

| Selector | Display |
|---:|---|
| `0C` | `M` |
| `0B` | `P` |
| `0A` | `R` |
| `09` | `N` |
| `08` | `D` |

In the app parser this is currently `payload[22]` in `parseGear7e1_21a0`.

Observed frame fragments:

```text
P: 7E92300000B0000FFF1
R: 7E92300000A0E00FFF1
N: 7E9230000090000FFF1
D: 7E9230000080101FFF1
M: 7E92300000C0101FFF1
```

## Notes For Future Scans

- Prefer short targeted scans. Broad PID sweeps are slow and produce many negative responses.
- Negative responses look like `7E9 03 7F <service> <code>`.
- `7E1 090A` identified the ECU as TCM: `ITCM!-Trans"misCtrl#`.
- Keep the browser app disconnected while using direct BlueZ capture.
- After direct capture, close `bluetoothctl` before reconnecting from the app.
