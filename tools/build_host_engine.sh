#!/usr/bin/env bash
#
# 네이티브(호스트) Rapfi 를 SPRT 대국용으로 빌드한다 — bench/sprt/runner.mjs 가 띄울 수 있는 폴더 하나.
#
#   OUT_DIR=engines/test RAPFI_PATCHES="tools/patches/x.patch" bash tools/build_host_engine.sh
#
# 만드는 것:  $OUT_DIR/pbrain-rapfi  +  config.toml · 가중치(엔진은 cwd 에서 찾는다 — 러너의 --a-cwd 로 그 폴더를 준다)
#
# tools/build_engine_wasm.sh [7/7] 의 호스트 빌드와 같은 소스 · 같은 옵션(-DNO_COMMAND_MODULES=ON -DENABLE_LTO=ON,
# ISA 자동 감지)이다. 다른 점은 패치를 얹을 수 있고, 빌드 디렉터리를 패치 묶음마다 따로 둔다는 것뿐이다 —
# 기준(패치 없음)과 시험(패치)을 한 작업 트리에서 차례로 빌드해도 서로의 산출물을 덮지 않는다.
# 엔진 소스는 빌드 전에 커밋 그대로 되돌리고, 끝나면 다시 되돌린다(rapfi 소스 캐시를 더럽히지 않게).
set -eu

RAPFI_COMMIT="${RAPFI_COMMIT:-3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7}"
NETWORKS_COMMIT="${NETWORKS_COMMIT:-e32ad77a5364363b3e3a02b3f9e8610ade19ea98}"
RAPFI_PATCHES="${RAPFI_PATCHES:-}"
# 예: "-DUSE_AVX2=OFF -DUSE_AVX512=OFF" — 기본은 build_engine_wasm.sh 와 같은 자동 감지
HOST_CMAKE_FLAGS="${HOST_CMAKE_FLAGS:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# cmake 가 Rapfi 의 요구(3.18.2)보다 낮은 러너면 공식 바이너리를 받아 PATH 앞에(tools/ci/ensure-cmake.sh).
# shellcheck disable=SC1091
source "$ROOT/tools/ci/ensure-cmake.sh"
WORK="${WORK:-$HOME/rapfi-wasm-work}"
OUT_DIR="${OUT_DIR:?OUT_DIR 를 주세요(예: bench/sprt/engines/base)}"
case "$OUT_DIR" in /*) ;; *) OUT_DIR="$ROOT/$OUT_DIR" ;; esac
# 병렬 빌드 수 — 코어 수와 컨테이너 메모리 한도 중 작은 쪽(tools/ci/build-jobs.sh).
# shellcheck disable=SC1091
source "$ROOT/tools/ci/build-jobs.sh"

mkdir -p "$WORK"
cd "$WORK"
if [ ! -d rapfi/.git ]; then
  rm -rf rapfi
  git clone -q https://github.com/dhbloo/rapfi.git
fi
cd rapfi
git cat-file -e "${RAPFI_COMMIT}^{commit}" 2> /dev/null || git fetch -q --all --tags
git checkout -q "$RAPFI_COMMIT"
git submodule update -q --init --depth 1 Networks
NET_ACTUAL="$(git -C Networks rev-parse HEAD)"
if [ "$NET_ACTUAL" != "$NETWORKS_COMMIT" ]; then
  echo "  X Networks 커밋이 다릅니다: $NET_ACTUAL != $NETWORKS_COMMIT"
  exit 1
fi

git checkout -q -- Rapfi
trap 'git -C "$WORK/rapfi" checkout -q -- Rapfi' EXIT
label="plain"
if [ -n "$RAPFI_PATCHES" ]; then
  for p in $RAPFI_PATCHES; do
    git apply --check "$ROOT/$p" || { echo "  X 패치가 적용되지 않습니다: $p"; exit 1; }
    git apply "$ROOT/$p"
    echo "  . 패치 적용: $p"
  done
  label="$(echo "$RAPFI_PATCHES" | sha1sum | cut -c1-10)"
fi

cd Rapfi
BUILD="build-sprt-$label"
# shellcheck disable=SC2086
cmake -S . -B "$BUILD" -G Ninja -DCMAKE_BUILD_TYPE=Release -DNO_COMMAND_MODULES=ON -DENABLE_LTO=ON $HOST_CMAKE_FLAGS \
  | grep -E "SSE:|AVX2:|AVX512:|BMI2:|VNNI:" | sed "s/^/  . /" || true
echo "  . c++ $("${CXX:-c++}" --version 2> /dev/null | head -1)"
# 출력은 파일로 받고, 실패하면 끝 60줄을 보인다 — 예전에는 > /dev/null 이라 컴파일 오류가 로그에 한 줄도 남지 않았다
# (RunPod 러너의 M3 SPRT 37336926210 이 「exit code 1」 만 남기고 멈췄다).
cmake --build "$BUILD" -j"$JOBS" > "$BUILD/build.log" 2>&1 \
  || { echo "  X 네이티브 빌드 실패 — $BUILD/build.log 끝:"; tail -60 "$BUILD/build.log"; exit 1; }

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp "$BUILD/pbrain-rapfi" "$OUT_DIR/"
cp "$WORK/rapfi/Networks/config-example/config.toml" "$OUT_DIR/"
cp "$WORK/rapfi/Networks/mix9svq/"*.bin.lz4 "$OUT_DIR/"
cp "$WORK/rapfi/Networks/classical/"*.bin "$OUT_DIR/"
{
  echo "upstream : $RAPFI_COMMIT (dhbloo/rapfi)"
  echo "networks : $NET_ACTUAL"
  echo "patches  : ${RAPFI_PATCHES:-없음}"
  echo "cmake    : -DCMAKE_BUILD_TYPE=Release -DNO_COMMAND_MODULES=ON -DENABLE_LTO=ON $HOST_CMAKE_FLAGS"
  echo "built_at : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$OUT_DIR/ENGINE_VERSION.txt"

# 확인 — BENCH 해시(1 스레드 결정적). 결과 불변 패치면 기준과 같아야 한다(e240ab16).
( cd "$OUT_DIR" && printf 'BENCH\nEND\n' | ./pbrain-rapfi > bench.txt 2>&1 ) || true
echo "  . $(grep -oE "Hash: [0-9a-f]+" "$OUT_DIR/bench.txt" | tail -1 || echo "Hash: 없음") · $(grep -oE "Nodes: [0-9]+" "$OUT_DIR/bench.txt" | tail -1 || true)"
echo "  . $OUT_DIR"
ls -l "$OUT_DIR" | sed "s/^/    /"
