#!/usr/bin/env bash
# Run ONLY on a disposable Android TV emulator in CI, never a customer device.
set -euo pipefail
APP="com.visionmidia.diagnosticlab.v04"
APK="android-diagnostic-lab/app/build/outputs/apk/debug/app-debug.apk"
DIR="android-diagnostic-lab/emulator-evidence"
mkdir -p "$DIR"
test -s "$APK"

echo "=== ANDROID TV EMULATOR ==="
adb devices
adb shell getprop ro.build.version.release
adb shell pm list features | grep -F "android.software.leanback" || true
adb shell wm size 1280x720
adb shell wm density 160

adb install -r "$APK"
adb shell am start -W -n "$APP/com.visionmidia.diagnosticlab.MainActivity"
sleep 3
adb shell pidof "$APP" | tee "$DIR/process-id.txt"
adb exec-out screencap -p > "$DIR/01-start.png"

dump_ui() {
  adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1
  adb exec-out cat /sdcard/window.xml > "$DIR/latest.xml"
}
tap_text() {
  local fragment="$1" pt
  dump_ui
  pt=$(python3 - "$DIR/latest.xml" "$fragment" <<'PY'
import sys, re, xml.etree.ElementTree as ET
root=ET.parse(sys.argv[1]).getroot()
for node in root.iter("node"):
  attrs=node.attrib
  if sys.argv[2].lower() not in attrs.get("text","").lower():
    continue
  if attrs.get("bounds") and attrs.get("visible-to-user","true")!="false":
    nums=[int(x) for x in re.findall(r'\d+', attrs["bounds"])]
    if len(nums)==4:
      print((nums[0]+nums[2])//2,(nums[1]+nums[3])//2)
      break
PY
)
  if [[ -z "$pt" ]]; then return 1; fi
  adb shell input tap $pt
}
has_text() {
  dump_ui
  python3 - "$DIR/latest.xml" "$1" <<'PY'
import xml.etree.ElementTree as ET,sys
root=ET.parse(sys.argv[1]).getroot()
texts=[n.attrib.get("text","") for n in root.iter("node")]
for item in texts:
  if sys.argv[2].lower() in item.lower():
    print(item)
    sys.exit(0)
sys.exit(1)
PY
}
tap_text "Rodar sequência"
sleep 7
adb exec-out screencap -p > "$DIR/02-basic-rotation.png"
has_text "fins simulados:" | tee "$DIR/basic-round.txt"
python3 - "$DIR/basic-round.txt" <<'PY'
import sys,re
s=open(sys.argv[1]).read()
m=re.search(r'fins simulados:\s*(\d+)',s)
if not m or int(m.group(1))<1: raise SystemExit("Basic rotation never advanced")
print("PASS: native offline basic rotation advanced "+m.group(1)+" items")
PY

# Scroll with the Android TV D-pad rather than relying on browser or a touch screen.
for attempt in $(seq 1 20); do
  if tap_text "INTERCALAR MP4 + IMAGENS"; then break; fi
  adb shell input keyevent KEYCODE_DPAD_DOWN
  adb shell input keyevent KEYCODE_DPAD_DOWN
  sleep 0.2
done
sleep 2
adb exec-out screencap -p > "$DIR/03-image-rotation-mode.png"
has_text "MÍDIA REAL + ANÚNCIO FICTÍCIO" | tee "$DIR/mode-open.txt"
tap_text "Iniciar rodízio real"
echo "PASS: media rotation mode opened and playback requested."
adb exec-out screencap -p > "$DIR/04-video-start.png"

# Observe screen/UI states; no production requests or analytics are available to the APK.
: > "$DIR/progression.txt"
for i in $(seq 1 14); do
  sleep 2
  dump_ui || true
  python3 - "$DIR/latest.xml" "$DIR/progression.txt" <<'PY'
import sys,xml.etree.ElementTree as ET
root=ET.parse(sys.argv[1]).getroot()
t=[n.attrib.get("text","") for n in root.iter("node")]
line=" | ".join(s for s in t if any(k in s for k in ("Rodada ","ANÚNCIO FICTÍCIO","EMPRESA ","MP4 ", "ERRO")))
with open(sys.argv[2],"a") as f: f.write(line+"\n")
print(line[:280])
PY
  if (( i == 4 || i == 8 || i == 13 )); then
    adb exec-out screencap -p > "$DIR/05-progress-$i.png"
  fi
done
python3 - "$DIR/progression.txt" <<'PY'
import sys
lines=open(sys.argv[1]).read()
if 'MP4 indisponível' in lines or 'ERRO MP4' in lines:
  raise SystemExit('Android TV emulator video decoder failed; consult progression and screenshots')
if not any(x in lines for x in ('EMPRESA A','EMPRESA B','item 4/8','item 8/8','Rodada 2')):
  raise SystemExit('No commercial image or second round observed within emulator observation window')
print('PASS: emulator observed a commercial position or later playback round')
PY
echo "PASS: Android TV emulator installation, native navigation and playback were exercised."
