#!/bin/sh
set -eu
cd "$(dirname "$0")"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
java -m jdk.compiler/com.sun.tools.javac.Main -d "$out" app/src/main/java/com/visionmidia/liveprobe/SessionPolicy.java tests/SessionPolicyTest.java
java -ea -cp "$out" com.visionmidia.liveprobe.SessionPolicyTest
java -m jdk.compiler/com.sun.tools.javac.Main -d "$out" app/src/main/java/com/visionmidia/liveprobe/CaptureSize.java app/src/main/java/com/visionmidia/liveprobe/CaptureSupport.java app/src/main/java/com/visionmidia/liveprobe/CloseStack.java tests/CaptureSafetyTest.java
java -ea -cp "$out" com.visionmidia.liveprobe.CaptureSafetyTest
python3 tests/verify_manifest.py
