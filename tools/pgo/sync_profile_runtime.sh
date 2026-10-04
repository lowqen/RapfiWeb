#!/usr/bin/env bash
#
# Emscripten 의 LLVM 프로파일 런타임을 그 clang 과 같은 LLVM 커밋으로 맞춘다 — PGO 계측 빌드 전에(P3-5).
#
# 왜: emsdk 6.0.11 의 clang 은 LLVM 24.0.0git(raw 프로파일 형식 11)인데, Emscripten 이 함께 싣는 compiler-rt
# 프로파일 런타임(system/lib/compiler-rt/lib/profile)은 그보다 오래돼 형식 10 이다. 그 결과
#   IR 계측(-fprofile-generate):        "LLVM Profile Error: Runtime and instrumentation version mismatch : expected 10, but get 11"
#   프런트엔드 계측(-fprofile-instr-generate): 종료 때 initializeValueProfRuntimeRecord 에서 memory access out of bounds
# (pgo.yml 진단 37171091827 · 37171907436). 엔진 코드가 아니라 툴체인 문제다.
#
# 어떻게: clang --version 이 찍는 LLVM 커밋에서 compiler-rt/{lib,include}/profile 만 받아(얕은 sparse 클론)
# Emscripten 의 같은 경로를 바꾸고, 캐시의 프로파일 라이브러리를 지워 emcc 가 다음 링크 때 새로 짓게 한다.
# 이미 맞으면 아무것도 하지 않는다(멱등). 원본은 .orig 로 남긴다.
set -eu

EMSDK_DIR="${EMSDK_DIR:-${WORK:-$HOME/rapfi-wasm-work}/emsdk}"
EM="$EMSDK_DIR/upstream/emscripten"
CLANG="$EMSDK_DIR/upstream/bin/clang"
RT="$EM/system/lib/compiler-rt"
[ -x "$CLANG" ] && [ -d "$RT/lib/profile" ] || { echo "  X emsdk 를 찾지 못했습니다: $EMSDK_DIR"; exit 1; }

ver_of () { grep -m1 -E "^#define INSTR_PROF_RAW_VERSION " "$1/include/profile/InstrProfData.inc" | awk '{print $3}'; }
commit="$("$CLANG" --version | sed -n 's/.*llvm-project \([0-9a-f]\{40\}\).*/\1/p' | head -1)"
[ -n "$commit" ] || { echo "  X clang --version 에서 LLVM 커밋을 못 읽었습니다: $("$CLANG" --version | head -1)"; exit 1; }
echo "  . clang LLVM 커밋 $commit"
echo "  . Emscripten 런타임 raw 형식 $(ver_of "$RT")"
echo "  . Emscripten 의 프로파일 라이브러리 정의:"
grep -n -A12 -i "class libprofile\|clang_rt.profile\|'profile'" "$EM/tools/system_libs.py" | head -24 | sed "s/^/    | /" || true

STAMP="$RT/.synced-llvm-commit"
if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$commit" ]; then
  echo "  . 이미 $commit 에 맞춰져 있음 — 건너뜀"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" remote add origin https://github.com/llvm/llvm-project.git
git -C "$tmp" config core.sparseCheckout true
printf '%s\n' compiler-rt/lib/profile compiler-rt/include/profile > "$tmp/.git/info/sparse-checkout"
git -C "$tmp" fetch -q --depth 1 --filter=blob:none origin "$commit"
git -C "$tmp" checkout -q FETCH_HEAD
up="$tmp/compiler-rt"
echo "  . LLVM $commit 의 런타임 raw 형식 $(ver_of "$up")"

# 바꾸기 — Emscripten 이 목록으로 고르는 파일만 쓰더라도 새 파일이 생겼을 수 있으니 디렉터리째
for d in lib/profile include/profile; do
  [ -d "$RT/$d.orig" ] || cp -r "$RT/$d" "$RT/$d.orig"
  rm -rf "${RT:?}/$d"
  cp -r "$up/$d" "$RT/$d"
done
echo "$commit" > "$STAMP"
echo "  . 바꿈 — Emscripten 런타임 raw 형식 이제 $(ver_of "$RT")"

# 캐시의 프로파일 라이브러리를 지운다(다음 링크에서 emcc 가 새 소스로 짓는다)
n=0
while IFS= read -r f; do rm -f "$f"; n=$((n + 1)); echo "    - $f"; done \
  < <(find "$EM/cache" -iname "*profile*" -name "*.a" 2> /dev/null)
echo "  . 캐시에서 지운 프로파일 라이브러리 $n 개"
