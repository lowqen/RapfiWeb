#!/usr/bin/env bash
#
# Rapfi -> WebAssembly 빌드 (RapfiWeb W0 스파이크).
#
# 이 스크립트가 만드는 것:
#   out/engine/rapfi-{single-simd128,multi-simd128}.{js,wasm,data}
#   out/engine/ENGINE_VERSION.txt
#   out/bench/{config.toml,*.bin.lz4,model210901.bin}   <- BENCH 대조 묶음
#
# 리눅스 x86_64(또는 GitHub Actions ubuntu-latest)에서 통째로 실행한다.
# RapfiDroid/tools/build_engine_android.sh 의 구조를 그대로 따른다 — 특히
# "빌드가 됐다"와 "엔진이 맞다"를 가르는 [5/6] 검증 게이트가 같은 이유로 여기 있다.
#
# pipefail 은 일부러 빼 둔다. 이 스크립트에는 `… | head -1` 과 `… | grep -q` 가
# 여럿인데, 오른쪽이 먼저 끝나면 왼쪽이 SIGPIPE(141)로 죽고 pipefail 이 그것을
# 빌드 실패로 바꾼다. 진짜 오류가 아니라 파이프 관용구가 실패로 둔갑하는 것이라,
# 잡고 싶은 것(명령 자체의 실패)은 set -e 가 이미 잡는다.
set -eu

# 앱(RapfiDroid)에 실린 것과 **같은 소스**에서 출발한다. 그래야 웹과 폰의
# 탐색 결과가 같다고 주장할 근거가 생긴다.
#
# ⚠ 처음에는 RapfiDroid/app/src/main/jniLibs/ENGINE_VERSION.txt 의
#   `upstream : 8d16fc2c…` 를 그대로 썼는데 그 커밋은 dhbloo/rapfi 에 없다(HTTP 422).
#   build_engine_android.sh 가 CMakeLists 를 패치하고 **로컬 커밋을 만든 뒤**
#   `rev-parse HEAD` 를 기록하기 때문이다 — 그래서 그 필드는 upstream 커밋이 아니라
#   패치된 커밋(lowqen/rapfi 의 android 브랜치)이다. 진짜 베이스는 그 부모다:
#
#     lowqen/rapfi  8d16fc2c  "build: Android(arm64-v8a) 크로스 컴파일 지원"
#       └ parent    3c94c2a9  dhbloo/rapfi "chore: finish module hygiene …" (2026-07-23)
#
#   안드로이드 패치 두 개는 출력 이름(libengine.so)과 bionic 의 libpthread 부재를
#   다루는 것이라 wasm 에는 해당이 없다. 그래서 패치 없이 베이스에서 바로 빌드한다.
RAPFI_COMMIT="${RAPFI_COMMIT:-3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7}"
# 가중치가 바뀌면 BENCH 해시 대조가 무의미해진다. 폰이 쓴 것과 같아야 한다.
NETWORKS_COMMIT="${NETWORKS_COMMIT:-e32ad77a5364363b3e3a02b3f9e8610ade19ea98}"
# 스파이크에서는 latest 를 쓰고 결과를 ENGINE_VERSION.txt 에 기록한다.
# W0 가 통과하면 그때 나온 버전을 여기 고정한다(안드로이드가 NDK r27c 를 박아둔 것과 같은 이유).
EMSDK_VERSION="${EMSDK_VERSION:-latest}"
ENABLE_LTO="${ENABLE_LTO:-ON}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${WORK:-$HOME/rapfi-wasm-work}"
OUT="$ROOT/out"
JOBS="$(nproc)"

echo ">>> [1/6] 도구"
mkdir -p "$WORK"
cd "$WORK"
# 캐시 액션이 미스에도 빈 디렉터리를 남길 수 있으므로 "있다"가 아니라
# "쓸 수 있다"로 판단한다.
if [ ! -x emsdk/emsdk ]; then
  rm -rf emsdk
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git
fi
cd emsdk
# 출력을 버리지 않는다. 첫 시도에서 이 단계가 조용히 죽었고, 로그를 /dev/null 로
# 보낸 탓에 원인을 볼 수 없었다. 한 번 시끄러운 편이 낫다.
./emsdk install "$EMSDK_VERSION"
./emsdk activate "$EMSDK_VERSION"
# emsdk_env.sh 는 미설정 변수를 건드리고 0 이 아닌 값을 돌려줄 수 있다.
# set -eu 아래에서 그대로 source 하면 스크립트가 여기서 끝난다.
set +eu
# shellcheck disable=SC1091
source ./emsdk_env.sh
set -eu
command -v emcc > /dev/null || { echo "emcc 가 PATH 에 없습니다 — emsdk 활성화 실패"; exit 1; }
EMSDK_RESOLVED="$(emcc -v 2>&1 | sed -n 1p)"
echo "  . $EMSDK_RESOLVED"
echo "  . cmake $(cmake --version | sed -n 1p)"
echo "  . node  $(node --version)"
echo "  . emcc  $(command -v emcc)"

echo ">>> [2/6] Rapfi 소스 + 가중치"
cd "$WORK"
if [ ! -d rapfi/.git ]; then
  rm -rf rapfi
  git clone -q https://github.com/dhbloo/rapfi.git
fi
cd rapfi
git fetch -q --all --tags
# 없는 커밋을 checkout 하면 git 은 "unable to read tree" 로 죽는데, 그 메시지만
# 보고는 얕은 클론 문제인지 커밋이 없는 건지 알 수 없다. 먼저 확인하고 말해 준다.
if ! git cat-file -e "${RAPFI_COMMIT}^{commit}" 2> /dev/null; then
  echo "  X 커밋 $RAPFI_COMMIT 가 dhbloo/rapfi 에 없습니다."
  echo "    (RapfiDroid 의 ENGINE_VERSION.txt 'upstream' 필드는 패치된 로컬 커밋입니다 — 그 부모를 쓰세요)"
  exit 1
fi
git checkout -q "$RAPFI_COMMIT"
git submodule update -q --init --depth 1 Networks

NET_ACTUAL="$(git -C Networks rev-parse HEAD)"
echo "  . rapfi    $(git rev-parse --short HEAD)"
echo "  . networks $(git -C Networks rev-parse --short HEAD)"
if [ "$NET_ACTUAL" != "$NETWORKS_COMMIT" ]; then
  # 가중치가 다르면 BENCH 해시가 달라지는 게 당연하고, 그러면 W0-3 은 엔진이
  # 아니라 입력이 다른 것을 재게 된다. 조용히 넘어가면 안 되는 종류의 차이다.
  echo "  X Networks 커밋이 폰이 쓴 것과 다릅니다: $NET_ACTUAL != $NETWORKS_COMMIT"
  echo "    가중치가 다르면 BENCH 해시 대조가 성립하지 않습니다."
  exit 1
fi

# 스파이크의 절반은 "upstream 이 실제로 무엇을 하는가"를 알아내는 것이다.
# 이 덤프가 링크 플래그·타깃 이름·emscripten 분기를 CI 로그에 남긴다.
echo "--- CMakeLists 의 emscripten/wasm 관련 줄 ---"
grep -n -iE "emscripten|wasm|pthread|MODULARIZE|EXPORT_NAME|ASYNCIFY|ALLOW_MEMORY|simd|NO_MULTI_THREADING|ffp-contract|OUTPUT_NAME" \
     Rapfi/CMakeLists.txt | sed "s/^/  | /" || echo "  (해당 줄 없음)"
echo "--- 끝 ---"

echo ">>> [3/6] 빌드 (SIMD 2종)"
cd "$WORK/rapfi/Rapfi"

# 링크 플래그는 **우리가 정하지 않는다.** upstream 의 CMakeLists 가 EMSCRIPTEN
# 블록에서 통째로 정해 둔다:
#
#   --pre-js emscripten/preamble.js   sendCommand / onReceiveStdout 펌프
#   -s MODULARIZE=1 -s EXPORT_NAME=Rapfi
#   -s EXPORTED_FUNCTIONS=['_main','_gomocupLoopOnce','_emscripten_force_exit']
#   -s EXPORTED_RUNTIME_METHODS=['cwrap']
#   -s EXIT_RUNTIME=1 -s ALLOW_MEMORY_GROWTH=1 -s IMPORTED_MEMORY=1 -s STACK_SIZE=2MB
#   --preload-file …                  Networks/wasm_preloads.txt 의 가중치
#   (멀티) -pthread -s PROXY_TO_PTHREAD=1
#   (SIMD) -msimd128 + USE_WASM_SIMD 정의
#
# 처음에는 여기에 우리 -s 플래그를 얹었는데 그건 틀린 접근이었다. CMake 는
# CMAKE_EXE_LINKER_FLAGS 를 타깃의 LINK_FLAGS **앞에** 놓고 emcc 는 뒤에 오는
# -s 가 이긴다 — 즉 우리 설정은 조용히 덮인다. 게다가 덮을 이유도 없었다:
# 우리가 만들려던 stdin 배관을 preamble.js 가 이미 제공한다.

build_variant () {
  local name=$1 threads=$2
  local dir="build-$name"
  local extra=()
  [ "$threads" = "ON" ] || extra+=(-DNO_MULTI_THREADING=ON)

  echo "--- build: $name (threads=$threads) ---"
  emcmake cmake -S . -B "$dir" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DNO_COMMAND_MODULES=ON \
    -DUSE_WASM_SIMD=ON \
    -DUSE_WASM_SIMD_RELAXED=OFF \
    "${extra[@]}"
  cmake --build "$dir" -j"$JOBS"
}

# **SIMD 없는 변형은 이 커밋에서 빌드되지 않는다.** eval/mix10nnue.cpp 가
#   static_assert(InstType != simd::InstructionType::SCALAR)
# 로 스칼라 백엔드를 거부하는데, 그 파일은 CORE_SOURCES 에 무조건 들어가고
# 빼는 CMake 옵션이 없다. upstream README 의 4종 안내는 mix10 이전 것이다.
# 그래서 SIMD 두 종만 만든다 — 지원 범위는 Chrome/Edge 91+, Firefox 89+,
# Safari 16.4+ 이고, 빠지는 것은 사실상 iOS 16.4 미만이다.
build_variant single-simd128 OFF
build_variant multi-simd128  ON

echo ">>> [4/6] 수집"
rm -rf "$OUT"
mkdir -p "$OUT/engine" "$OUT/bench"

collect () {
  local name=$1
  local dir="build-$name"
  # 타깃 이름은 upstream 이 정한다(호스트에서는 pbrain-rapfi). 확실한 것은
  # "이 빌드 디렉터리에 .js 와 .wasm 이 하나씩 나왔다"뿐이므로 그렇게 찾는다.
  local js
  local wasm
  js="$(find "$dir" -maxdepth 2 -name "*.js" ! -name "*.worker.js" | head -1)"
  wasm="$(find "$dir" -maxdepth 2 -name "*.wasm" | head -1)"
  if [ -z "$js" ] || [ -z "$wasm" ]; then
    echo "  X $name: 산출물을 찾지 못했습니다"
    find "$dir" -maxdepth 2 -type f | sed "s/^/      /"
    exit 1
  fi
  cp "$js"   "$OUT/engine/rapfi-$name.js"
  cp "$wasm" "$OUT/engine/rapfi-$name.wasm"
  # .data 는 --preload-file 로 구워진 가중치다. 없으면 엔진이 config.toml 을
  # 못 찾아 뜨자마자 죽으므로, 없는 것은 실패로 다룬다.
  local data
  data="$(find "$dir" -maxdepth 2 -name "*.data" | head -1)"
  if [ -z "$data" ]; then
    echo "  X $name: .data(가중치 프리로드)가 없습니다"
    exit 1
  fi
  cp "$data" "$OUT/engine/rapfi-$name.data"
  # pthread 빌드는 emscripten 버전에 따라 별도 워커 스크립트를 낼 수 있다.
  find "$dir" -maxdepth 2 -name "*.worker.js" -exec cp {} "$OUT/engine/rapfi-$name.worker.js" \; || true
}
for n in single-simd128 multi-simd128; do collect "$n"; done
# upstream 은 EXPORT_ES6 를 쓰지 않는다 — 글루는 CommonJS 다. 그런데 저장소 루트
# package.json 에 "type": "module" 이 있어 node 가 이 .js 를 ESM 으로 읽고
# "require is not defined" 로 죽는다. 이 한 줄이 그 폴더만 예외로 돌린다.
echo '{ "type": "commonjs" }' > "$OUT/engine/package.json"
ls -l "$OUT/engine" | sed "s/^/  . /"

echo ">>> [5/6] 검증 게이트 — 조용한 잘못된 빌드를 여기서 잡는다"
# 안드로이드와 같은 발상: 조용히 무시되는 경로가 있는 옵션들을 여기서 확인한다.
# 특히 -ffp-contract=off 는 x86·폰과 탐색 결과가 같다는 주장의 근거이고,
# --pre-js preamble.js 는 sendCommand 펌프가 들어왔다는 유일한 증거다.
verify () {
  local name=$1 threads=$2
  local dir="build-$name"
  local nj="$dir/build.ninja"
  local fail=0
  echo "--- verify: $name ---"

  if ! file -b "$OUT/engine/rapfi-$name.wasm" | grep -qi "WebAssembly"; then
    echo "  X WebAssembly 바이너리가 아님: $(file -b "$OUT/engine/rapfi-$name.wasm")"
    fail=1
  fi
  if ! grep -q -- "-ffp-contract=off" "$nj"; then
    echo "  X -ffp-contract=off 없음 — x86/폰과 탐색 결과가 갈릴 수 있다"
    fail=1
  fi
  if ! grep -q -- "-msimd128" "$nj"; then
    echo "  X -msimd128 없음 — 스칼라 빌드다(이 커밋에서는 링크도 안 된다)"
    fail=1
  fi
  if ! grep -q -- "preamble.js" "$nj"; then
    echo "  X --pre-js preamble.js 가 없다 — sendCommand 펌프 없이 나온 빌드다"
    fail=1
  fi
  if [ "$threads" = "ON" ]; then
    grep -q -- "-pthread" "$nj" || { echo "  X -pthread 없음"; fail=1; }
    grep -q -- "PROXY_TO_PTHREAD" "$nj" || { echo "  X PROXY_TO_PTHREAD 없음"; fail=1; }
  else
    grep -q -- "-pthread" "$nj" && { echo "  X 단일 스레드 변형인데 -pthread 가 있다"; fail=1; }
  fi

  echo "  . js   $(stat -c%s "$OUT/engine/rapfi-$name.js") bytes"
  echo "  . wasm $(stat -c%s "$OUT/engine/rapfi-$name.wasm") bytes"
  echo "  . data $(stat -c%s "$OUT/engine/rapfi-$name.data") bytes"
  if [ "$fail" -ne 0 ]; then
    echo "검증 실패: $name"
    exit 1
  fi
  echo "  OK $name"
}
verify single-simd128 OFF
verify multi-simd128  ON

echo ">>> [6/6] BENCH 대조 묶음 + 버전 기록"
# 안드로이드 스크립트와 **같은 파일들**이어야 대조가 성립한다.
# 이 config 는 default_thread_num = 1 이라 BENCH 가 결정적이다 — 스레드 수를 건드리지 말 것.
cp "$WORK/rapfi/Networks/config-example/config.toml" "$OUT/bench/"
cp "$WORK/rapfi/Networks/mix9svq/"*.bin.lz4          "$OUT/bench/"
cp "$WORK/rapfi/Networks/classical/model210901.bin"  "$OUT/bench/"
ls -l "$OUT/bench" | sed "s/^/  . /"

{
  # 여기서 upstream 은 **패치되지 않은 dhbloo/rapfi 커밋**이다. 안드로이드의
  # 같은 이름 필드가 패치된 로컬 커밋을 가리켜 혼동을 부른 적이 있으므로
  # (이 파일 상단 주석 참고) 무엇인지 함께 적는다.
  echo "engine     : Rapfi WebAssembly (SIMD 2종)"
  echo "upstream   : $(git -C "$WORK/rapfi" rev-parse HEAD)  (dhbloo/rapfi, 패치 없음)"
  echo "networks   : $(git -C "$WORK/rapfi/Networks" rev-parse HEAD)"
  echo "emscripten : $EMSDK_RESOLVED"
  echo "cmake opts : -DNO_COMMAND_MODULES=ON -DUSE_WASM_SIMD=ON -DUSE_WASM_SIMD_RELAXED=OFF -DCMAKE_BUILD_TYPE=Release"
  echo "link opts  : (upstream CMakeLists 의 EMSCRIPTEN 블록이 전부 정한다 — 우리는 얹지 않는다)"
  echo "variants   : single-simd128 / multi-simd128"
  echo "note       : SIMD 없는 변형은 eval/mix10nnue.cpp 의 static_assert 때문에 이 커밋에서 빌드되지 않는다"
  echo "built_at   : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "build_by   : RapfiWeb/tools/build_engine_wasm.sh"
  echo "bench      : spike/node-bench.mjs 가 두 변형에서 Hash 를 뽑아 e240ab16 과 대조한다"
} > "$OUT/engine/ENGINE_VERSION.txt"
sed "s/^/  . /" "$OUT/engine/ENGINE_VERSION.txt"

echo "=========================================================="
echo "완료: $OUT"
echo "=========================================================="
