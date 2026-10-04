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

WORK="${WORK:-$HOME/rapfi-wasm-work}"
EMSDK_DIR="${EMSDK_DIR:-$WORK/emsdk}"
# emsdk 가 아직 없으면(캐시 미스) build_engine_wasm.sh [1/6] 과 같은 방식으로 깐다 — 같은 판(EMSDK_VERSION)이어야 한다
if [ ! -x "$EMSDK_DIR/upstream/bin/clang" ]; then
  echo "  . emsdk 가 없어 설치한다(${EMSDK_VERSION:-latest})"
  mkdir -p "$(dirname "$EMSDK_DIR")"
  [ -x "$EMSDK_DIR/emsdk" ] || { rm -rf "$EMSDK_DIR"; git clone -q --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"; }
  ( cd "$EMSDK_DIR" && ./emsdk install "${EMSDK_VERSION:-latest}" > /dev/null && ./emsdk activate "${EMSDK_VERSION:-latest}" > /dev/null )
fi
EM="$EMSDK_DIR/upstream/emscripten"
CLANG="$EMSDK_DIR/upstream/bin/clang"
# 프로파일 런타임 소스가 있는 compiler-rt 루트를 찾는다(…/compiler-rt/lib/profile)
prof="$(find "$EM/system/lib" -type d -path "*compiler-rt*/lib/profile" ! -path "*.orig*" 2> /dev/null | head -1)"
if [ ! -x "$CLANG" ] || [ -z "$prof" ]; then
  echo "  X emsdk 나 프로파일 런타임 소스를 찾지 못했습니다: clang=$CLANG"
  find "$EM/system/lib" -maxdepth 3 -type d -iname "*compiler*" 2> /dev/null | sed "s/^/    /"
  exit 1
fi
RT="${prof%/lib/profile}"
echo "  . 런타임 소스 $RT"
[ -f "$RT/include/profile/InstrProfData.inc" ] || {
  echo "  X $RT/include/profile/InstrProfData.inc 가 없다"
  find "$EM/system" -name InstrProfData.inc | sed "s/^/    /"
  exit 1
}

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
# Emscripten 은 lib/profile 의 소스를 몽땅 컴파일한다. 새 런타임에는 GPU 전용 파일(InstrProfilingPlatformROCm.cpp 등)이
# 있는데 Emscripten 에 없는 sanitizer/interception 헤더를 쓴다 — WASM 과 무관하고 원래 사본에도 없던 것들이라 뺀다.
for f in "$RT/lib/profile"/*; do
  [ -f "$f" ] || continue
  if grep -q -E '#include "(interception|sanitizer_common)/' "$f"; then
    if [ -e "$RT/lib/profile.orig/$(basename "$f")" ]; then
      echo "  X $(basename "$f") 는 원래 사본에도 있는데 sanitizer/interception 을 쓴다 — 손으로 봐야 한다"
      exit 1
    fi
    rm -f "$f"
    echo "    - 뺌: $(basename "$f")(sanitizer/interception 의존 · 원래 사본에 없음)"
  fi
done
# Emscripten 이 자기 사본에 얹어 둔 손질을 다시 한다 — upstream 은 호스트 이름을 __wasi__ 에서만 빈 값으로 두고
# 나머지는 lprofGetHostName(COMPILER_RT_HAS_UNAME 일 때만 정의)을 부른다. Emscripten 빌드는 그 매크로를 안 켜서
# 링크가 "undefined symbol: lprofGetHostName" 으로 실패한다(진단 37172796755).
port="$RT/lib/profile/InstrProfilingPort.h"
if grep -q '^#if defined(__ORBIS__) || defined(__wasi__)$' "$port"; then
  sed -i 's/^#if defined(__ORBIS__) || defined(__wasi__)$/#if defined(__ORBIS__) || defined(__wasi__) || defined(__EMSCRIPTEN__)/' "$port"
  echo "    + InstrProfilingPort.h: 호스트 이름 — __EMSCRIPTEN__ 도 빈 값"
elif ! grep -q '__EMSCRIPTEN__' "$port"; then
  echo "  X InstrProfilingPort.h 의 호스트 이름 분기를 찾지 못했다 — upstream 이 바뀌었다, 손으로 볼 것"
  exit 1
fi
echo "$commit" > "$STAMP"
echo "  . 바꿈 — Emscripten 런타임 raw 형식 이제 $(ver_of "$RT")"

# 캐시에서 프로파일 런타임이 든 라이브러리를 지운다(다음 링크에서 emcc 가 새 소스로 짓는다). Emscripten 은 런타임을
# 따로 두지 않고 libclang_rt.builtins*.a 안에 넣는다 — 이름이 아니라 **안에 InstrProfiling 오브젝트가 있는지**로 찾는다.
# (전체 실행 37173743283: 기준 빌드가 먼저 옛 소스로 builtins 를 캐시에 지어 둔 탓에, 이름으로만 찾던 sync 가 아무것도
# 못 지웠고 계측 빌드가 옛 런타임으로 링크돼 — 모듈 ID 가 첫 실행과 같은 006dc672 — 다시 OOB 로 죽었다.)
n=0
while IFS= read -r f; do
  rm -f "$f"
  n=$((n + 1))
  echo "    - $f"
done < <(find "$EM/cache" -name "*.a" -exec grep -l -a "InstrProfiling" {} + 2> /dev/null)
echo "  . 캐시에서 지운(프로파일 런타임이 든) 라이브러리 $n 개"
