#!/usr/bin/env bash
# Additional v0.5 actual Android TV emulator regression.
# Assumes the preceding emulator smoke left MediaRotationActivity visible.
set -euo pipefail
DIR="android-diagnostic-lab/emulator-evidence/recovery"
mkdir -p "$DIR"
dump_ui() {
  adb shell uiautomator dump /sdcard/recovery.xml >/dev/null 2>&1
  adb exec-out cat /sdcard/recovery.xml > "$DIR/window.xml"
}
tap_text() {
  local fragment="$1" pt
  dump_ui
  pt=$(python3 - "$DIR/window.xml" "$fragment" <<'PY'
import sys,re,xml.etree.ElementTree as ET
for node in ET.parse(sys.argv[1]).getroot().iter("node"):
 a=node.attrib
 if sys.argv[2].lower() in a.get("text","").lower():
  z=[int(x) for x in re.findall(r'\d+',a.get("bounds",""))]
  if len(z)==4:
   print((z[0]+z[2])//2,(z[1]+z[3])//2)
   break
PY
)
  if [[ -z "$pt" ]]; then echo "Cannot find button: $fragment" >&2; return 1; fi
  adb shell input tap $pt
}
progress() {
  dump_ui
  python3 - "$DIR/window.xml" <<'PY'
import sys,re,xml.etree.ElementTree as ET
text=" ".join(n.attrib.get("text","") for n in ET.parse(sys.argv[1]).getroot().iter("node"))
matches=re.findall(r'Rodada\s*(\d+)\s*·\s*item\s*(\d+)/8\s*·\s*concluídos\s*(\d+)\s*·\s*comerciais fictícios exibidos\s*(\d+)',text)
if not matches:
 print("ERROR: no valid native counter",file=sys.stderr)
 sys.exit(2)
print(*matches[-1])
PY
}
check_progress() {
  local expected="$1" label="$2" line concluded
  line=$(progress)
  echo "$label = $line" | tee -a "$DIR/recovery-log.txt"
  concluded=$(echo "$line" | awk '{print $3}')
  if ((concluded<expected)); then
    echo "FAIL: $label failed to advance (expected at least $expected, got $concluded)" >&2
    exit 1
  fi
}
: > "$DIR/recovery-log.txt"
tap_text "Recomeçar do item 1"
tap_text "Iniciar rodízio real"
sleep 0.5
tap_text "Simular reinício 2 s"
# This was the v0.4 bug: stale decoder callback prevented progression forever.
sleep 8
check_progress 1 "PASS after restart during H264"
adb exec-out screencap -p > "$DIR/01-restart-resumed.png"

tap_text "Recomeçar do item 1"
tap_text "Iniciar rodízio real"
sleep 0.5
tap_text "Simular queda 3 s"
sleep 10
check_progress 1 "PASS after disconnect/reconnect during H264"
adb exec-out screencap -p > "$DIR/02-reconnected.png"

tap_text "Recomeçar do item 1"
tap_text "Iniciar rodízio real"
sleep 0.5
tap_text "Simular reinício 2 s"
tap_text "Pausar"
sleep 3
# It must be possible to explicitly resume after cancelling the interrupted restart.
tap_text "Iniciar rodízio real"
sleep 6
check_progress 1 "PASS after pause-during-restart"
adb exec-out screencap -p > "$DIR/03-pause-restart.png"

tap_text "Recomeçar do item 1"
tap_text "Iniciar rodízio real"
sleep 0.5
tap_text "Simular queda 3 s"
tap_text "Pausar"
sleep 3
tap_text "Iniciar rodízio real"
sleep 6
check_progress 1 "PASS after pause-during-disconnect"
adb exec-out screencap -p > "$DIR/04-pause-disconnect.png"

# Verify no accidental client/production process was started in the emulator.
adb shell pidof com.visionmidia.diagnosticlab.v05 >/dev/null
if adb shell pm list packages | grep -Fq 'com.visionmidia.player'; then
 echo "FAIL: customer player was present in test emulator" >&2
 exit 1
fi
echo "PASS: all four offline H264 recovery scenarios in disposable Android TV emulator"
