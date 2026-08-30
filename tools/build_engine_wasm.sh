#!/usr/bin/env bash
#
# Rapfi -> WebAssembly 4종 빌드 (RapfiWeb W0 스파이크).
#
# 이 스크립트가 만드는 것:
#   out/engine/rapfi-{single,single-simd128,multi,multi-simd128}.{js,wasm}
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

# 앱(RapfiDroid)에 실린 것과 **같은 커밋**에서 출발한다. 그래야 웹과 폰의
# 탐색 결과가 같다고 주장할 근거가 생긴다.
RAPFI_COMMIT="${RAPFI_COMMIT:-8d16fc2cee9cfdec7ac007b24a7325c221aecb86}"
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
git checkout -q "$RAPFI_COMMIT"
git submodule update -q --init --depth 1 Networks
echo "  . rapfi    $(git rev-parse --short HEAD)"
echo "  . networks $(git -C Networks rev-parse --short HEAD)"

# 스파이크의 절반은 "upstream 이 실제로 무엇을 하는가"를 알아내는 것이다.
# 이 덤프가 링크 플래그·타깃 이름·emscripten 분기를 CI 로그에 남긴다.
echo "--- CMakeLists 의 emscripten/wasm 관련 줄 ---"
grep -n -iE "emscripten|wasm|pthread|MODULARIZE|EXPORT_NAME|ASYNCIFY|ALLOW_MEMORY|simd|NO_MULTI_THREADING|ffp-contract|OUTPUT_NAME" \
     Rapfi/CMakeLists.txt | sed "s/^/  | /" || echo "  (해당 줄 없음)"
echo "--- 끝 ---"

echo ">>> [3/6] 빌드 (4종)"
cd "$WORK/rapfi/Rapfi"

# 우리가 반드시 필요로 하는 모듈 형태. 브라우저와 node 에서 **같은 산출물**을
# 같은 방식으로 띄울 수 있어야 스파이크가 의미를 갖는다:
#   MODULARIZE/EXPORT_NAME  import 시점에 main() 이 돌지 않게
#   INVOKE_RUN=0 + callMain 언제 시작할지 우리가 정한다(가중치 주입 후)
#   FORCE_FILESYSTEM        엔진이 cwd 에서 config.toml/가중치를 fopen 한다
#   FS/callMain export      가중치를 FS.writeFile 로 넣는다
#   ALLOW_MEMORY_GROWTH     해시 테이블 크기를 런타임에 고른다
#   EXPORT_ES6              node 의 import() 와 모듈 워커에서 같은 파일을 그대로 쓴다
LINK_COMMON="-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createRapfi -sINVOKE_RUN=0"
LINK_COMMON="$LINK_COMMON -sFORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1 -sEXIT_RUNTIME=1"
LINK_COMMON="$LINK_COMMON -sEXPORTED_RUNTIME_METHODS=FS,callMain"
LINK_COMMON="$LINK_COMMON -sENVIRONMENT=web,worker,node"

build_variant () {
  local name=$1 simd=$2 threads=$3
  local dir="build-$name"
  local link="$LINK_COMMON"
  local extra=()

  if [ "$threads" = "ON" ]; then
    # 풀을 미리 띄운다. 워커의 main 스레드가 stdin 에서 Atomics.wait 로 잠든
    # 사이에는 이벤트 루프가 돌지 않아 새 pthread 를 만들 수 없기 때문이다 —
    # W0-1 이 확인하려는 바로 그 지점이다.
    link="$link -sPTHREAD_POOL_SIZE=8 -sPTHREAD_POOL_SIZE_STRICT=0"
  else
    extra+=(-DNO_MULTI_THREADING=ON)
  fi

  echo "--- build: $name (SIMD=$simd, threads=$threads, LTO=$ENABLE_LTO) ---"
  emcmake cmake -S . -B "$dir" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DNO_COMMAND_MODULES=ON \
    -DUSE_WASM_SIMD="$simd" \
    -DUSE_WASM_SIMD_RELAXED=OFF \
    -DENABLE_LTO="$ENABLE_LTO" \
    -DCMAKE_EXE_LINKER_FLAGS="$link" \
    "${extra[@]}"
  cmake --build "$dir" -j"$JOBS"
}

build_variant single         OFF OFF
build_variant single-simd128 ON  OFF
build_variant multi          OFF ON
build_variant multi-simd128  ON  ON

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
  # pthread 빌드는 emscripten 버전에 따라 별도 워커 스크립트를 낼 수 있다.
  find "$dir" -maxdepth 2 -name "*.worker.js" -exec cp {} "$OUT/engine/rapfi-$name.worker.js" \; || true
  find "$dir" -maxdepth 2 -name "*.data"      -exec cp {} "$OUT/engine/rapfi-$name.data" \; || true
}
for n in single single-simd128 multi multi-simd128; do collect "$n"; done
# EXPORT_ES6 산출물은 ESM 이다. node 는 가장 가까운 package.json 으로 모듈 종류를
# 정하므로, 확장자를 .mjs 로 바꾸는 대신 이 한 줄로 .js 를 ESM 으로 읽게 한다.
echo '{ "type": "module" }' > "$OUT/engine/package.json"
ls -l "$OUT/engine" | sed "s/^/  . /"

echo ">>> [5/6] 검증 게이트 — 조용한 잘못된 빌드를 여기서 잡는다"
# 안드로이드와 같은 발상: 두 옵션 모두 조용히 무시되는 경로가 있다.
# USE_WASM_SIMD 가 안 먹으면 스칼라 빌드가 나오고, ENABLE_LTO 는 실패해도
# 경고만 찍는다. 둘 다 "빌드 성공, 엔진은 느림/다름"으로 끝난다.
verify () {
  local name=$1 simd=$2 threads=$3
  local dir="build-$name"
  local nj="$dir/build.ninja"
  local fail=0
  echo "--- verify: $name ---"

  if ! file -b "$OUT/engine/rapfi-$name.wasm" | grep -qi "WebAssembly"; then
    echo "  X WebAssembly 바이너리가 아님: $(file -b "$OUT/engine/rapfi-$name.wasm")"
    fail=1
  fi
  # 이 플래그가 해시 동일성의 근거다. 없으면 x86/폰과 탐색 결과가 갈릴 수 있다.
  if ! grep -q -- "-ffp-contract=off" "$nj"; then
    echo "  X -ffp-contract=off 없음 — x86/폰과 탐색 결과가 갈릴 수 있다"
    fail=1
  fi
  if [ "$ENABLE_LTO" = "ON" ] && ! grep -q -- "-flto" "$nj"; then
    echo "  X LTO 미적용 — check_ipo_supported 가 실패했는데 경고만 찍고 넘어갔다"
    fail=1
  fi
  if [ "$simd" = "ON" ]; then
    if ! grep -q -- "-msimd128" "$nj"; then
      echo "  X -msimd128 없음 — 스칼라 빌드다"
      fail=1
    fi
  else
    if grep -q -- "-msimd128" "$nj"; then
      echo "  X SIMD 없는 변형인데 -msimd128 이 있다"
      fail=1
    fi
  fi
  if [ "$threads" = "ON" ]; then
    if ! grep -q -- "-pthread" "$nj"; then
      echo "  X -pthread 없음 — 멀티스레드 변형이 아니다"
      fail=1
    fi
  else
    if grep -q -- "-pthread" "$nj"; then
      echo "  X 단일 스레드 변형인데 -pthread 가 있다"
      fail=1
    fi
  fi
  # 우리가 넣은 링크 설정이 upstream 것에 밀리지 않았는지. 밀렸다면 하네스가
  # 통째로 못 뜨므로, 실패시키기 전에 로그로 알아야 한다.
  for s in MODULARIZE EXPORT_NAME INVOKE_RUN FORCE_FILESYSTEM; do
    if ! grep -q -- "-s$s" "$nj"; then
      echo "  ! 링크 플래그 -s$s 가 링크 줄에 안 보인다 (하네스에서 확인 필요)"
    fi
  done

  echo "  . js   $(stat -c%s "$OUT/engine/rapfi-$name.js") bytes"
  echo "  . wasm $(stat -c%s "$OUT/engine/rapfi-$name.wasm") bytes"
  if [ "$fail" -ne 0 ]; then
    echo "검증 실패: $name"
    exit 1
  fi
  echo "  OK $name"
}
verify single         OFF OFF
verify single-simd128 ON  OFF
verify multi          OFF ON
verify multi-simd128  ON  ON

echo ">>> [6/6] BENCH 대조 묶음 + 버전 기록"
# 안드로이드 스크립트와 **같은 파일들**이어야 대조가 성립한다.
# 이 config 는 default_thread_num = 1 이라 BENCH 가 결정적이다 — 스레드 수를 건드리지 말 것.
cp "$WORK/rapfi/Networks/config-example/config.toml" "$OUT/bench/"
cp "$WORK/rapfi/Networks/mix9svq/"*.bin.lz4          "$OUT/bench/"
cp "$WORK/rapfi/Networks/classical/model210901.bin"  "$OUT/bench/"
ls -l "$OUT/bench" | sed "s/^/  . /"

{
  echo "engine     : Rapfi WebAssembly (4종)"
  echo "upstream   : $(git -C "$WORK/rapfi" rev-parse HEAD)"
  echo "networks   : $(git -C "$WORK/rapfi/Networks" rev-parse HEAD)"
  echo "emscripten : $EMSDK_RESOLVED"
  echo "cmake opts : -DNO_COMMAND_MODULES=ON -DUSE_WASM_SIMD_RELAXED=OFF -DENABLE_LTO=$ENABLE_LTO -DCMAKE_BUILD_TYPE=Release"
  echo "link opts  : $LINK_COMMON"
  echo "variants   : single / single-simd128 / multi / multi-simd128"
  echo "built_at   : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "build_by   : RapfiWeb/tools/build_engine_wasm.sh"
  echo "bench      : spike/node-bench.mjs 가 4종 모두에서 Hash 를 뽑아 e240ab16 과 대조한다"
} > "$OUT/engine/ENGINE_VERSION.txt"
sed "s/^/  . /" "$OUT/engine/ENGINE_VERSION.txt"

echo "=========================================================="
echo "완료: $OUT"
echo "=========================================================="
