#!/usr/bin/env bash
#
# W0-3 진단: BENCH 해시가 32비트/64비트 타깃 사이에서 애초에 이식 가능한가?
#
# 관찰: wasm(4100a973) != 네이티브(e240ab16) 인데 **탐색 노드 수는 4,391,204 로
# 완전히 같다**. 설정 차이는 이미 배제됐다(같은 커밋 호스트 바이너리를 두 config
# 로 각각 돌려 둘 다 e240ab16).
#
# 가설: 부동소수점도 SIMD 도 아니고 **해시를 만드는 방식**이 원인이다.
#
#   command/benchmark.cpp
#       size_t nodes = Search::Engine.nodesSearched();
#       hasher << nodes;                                  // (1)
#       hasher << Search::Engine.main()->rootMoves[0].value;
#
#   core/hash.h
#       XXH64_update(state, &v, sizeof(T));               // 객체 표현 그대로
#
#   (1) 의 T 는 size_t 다. x86-64/arm64 에서는 8바이트, **wasm32 에서는 4바이트**다.
#   즉 노드 수와 평가값이 완전히 같아도 해시 스트림의 바이트 수가 달라진다.
#   이 가설이 맞다면 해시는 엔진이 다르다는 증거가 아니라 **타깃 폭의 그림자**다.
#
# 검증: benchmark.cpp 한 줄을 고정폭으로 바꿔(uint64_t) 호스트와 wasm 을 각각
# 다시 굽고 해시를 비교한다.
#
#   같아지면  -> 가설 확정. 엔진은 같은 답을 내고 있었다. upstream 에 한 줄 패치를 제안한다.
#   여전히 다르면 -> 가설 기각. 그때 eval/simd 의 WASM 분기를 파고든다.
#
# 이 패치는 **진단 전용**이다. 배포 빌드에는 들어가지 않는다(스크립트가 끝에서 되돌린다).
set -eu

RAPFI_COMMIT="${RAPFI_COMMIT:-3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${WORK:-$HOME/rapfi-wasm-work}"
OUT="$ROOT/out-diag"
JOBS="$(nproc)"
TARGET="Rapfi/command/benchmark.cpp"

echo ">>> [1/5] 도구"
[ -x "$WORK/emsdk/emsdk" ] || { echo "emsdk 가 없습니다: $WORK/emsdk (build_engine_wasm.sh 를 먼저 돌리세요)"; exit 1; }
[ -d "$WORK/rapfi/.git" ] || { echo "rapfi 소스가 없습니다: $WORK/rapfi"; exit 1; }
cd "$WORK/emsdk"
set +eu
# shellcheck disable=SC1091
source ./emsdk_env.sh
set -eu
command -v emcc > /dev/null || { echo "emcc 가 PATH 에 없습니다"; exit 1; }

echo ">>> [2/5] 소스 준비 + 진단 패치"
cd "$WORK/rapfi"
git checkout -q "$RAPFI_COMMIT"
git checkout -q -- "$TARGET"
git submodule update -q --init --depth 1 Networks

echo "  . 패치 전:"
grep -n "hasher << nodes" "$TARGET" | sed "s/^/      /"
# size_t -> uint64_t. 폭이 타깃마다 달라지는 유일한 지점이다
# (rootMoves[0].value 의 Value 는 int 라 양쪽 다 4바이트).
sed -i "s/hasher << nodes;/hasher << uint64_t(nodes);/" "$TARGET"
echo "  . 패치 후:"
grep -n "hasher << uint64_t(nodes)" "$TARGET" | sed "s/^/      /"
grep -q "hasher << uint64_t(nodes)" "$TARGET" || { echo "  X 패치가 적용되지 않았습니다"; exit 1; }

restore () { git -C "$WORK/rapfi" checkout -q -- "$TARGET" || true; }
trap restore EXIT

echo ">>> [3/5] 호스트 빌드(패치본)"
cd "$WORK/rapfi/Rapfi"
cmake -S . -B build-diag-host -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DNO_COMMAND_MODULES=ON -DENABLE_LTO=ON > /dev/null
cmake --build build-diag-host -j"$JOBS" > /dev/null
echo "  . 완료"

echo ">>> [4/5] wasm 빌드(패치본, single-simd128)"
emcmake cmake -S . -B build-diag-wasm -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DNO_COMMAND_MODULES=ON \
  -DNO_MULTI_THREADING=ON -DUSE_WASM_SIMD=ON -DUSE_WASM_SIMD_RELAXED=OFF > /dev/null
cmake --build build-diag-wasm -j"$JOBS" > /dev/null
rm -rf "$OUT"; mkdir -p "$OUT/engine"
cp "$(find build-diag-wasm -maxdepth 2 -name '*.js'   ! -name '*.worker.js' | head -1)" "$OUT/engine/rapfi-single-simd128.js"
cp "$(find build-diag-wasm -maxdepth 2 -name '*.wasm' | head -1)"                        "$OUT/engine/rapfi-single-simd128.wasm"
cp "$(find build-diag-wasm -maxdepth 2 -name '*.data' | head -1)"                        "$OUT/engine/rapfi-single-simd128.data"
echo '{ "type": "commonjs" }' > "$OUT/engine/package.json"
echo "  . 완료"

echo ">>> [5/5] 같은 config 로 둘 다 BENCH"
DIR="$WORK/hostbench-diag"
rm -rf "$DIR"; mkdir -p "$DIR"
cp "$WORK/rapfi/Networks/config-example/gomocalc-mix9svq.toml" "$DIR/config.toml"
cp "$WORK/rapfi/Networks/mix9svq/"*.bin.lz4 "$DIR/"
cp "$WORK/rapfi/Networks/classical/"*.bin   "$DIR/"
( cd "$DIR" && printf 'BENCH\nEND\n' | "$WORK/rapfi/Rapfi/build-diag-host/pbrain-rapfi" > bench.txt 2>&1 ) || true
HOST_HASH="$(grep -oE "Hash: [0-9a-f]+" "$DIR/bench.txt" | tail -1 | awk '{print $2}')"
HOST_NODES="$(grep -oE "Nodes: [0-9]+" "$DIR/bench.txt" | tail -1 | awk '{print $2}')"

WASM_JSON="$(ENGINE_DIR="$OUT/engine" node "$ROOT/spike/node-hash.mjs" single-simd128 || true)"
WASM_HASH="$(echo "$WASM_JSON" | sed -n 's/.*"hash":"\([0-9a-f]*\)".*/\1/p')"
WASM_NODES="$(echo "$WASM_JSON" | sed -n 's/.*"nodes":"\([0-9,]*\)".*/\1/p')"

echo "=========================================================="
echo "  진단: hasher << uint64_t(nodes)  (고정폭)"
echo "----------------------------------------------------------"
printf "    host  hash=%-10s nodes=%s\n" "${HOST_HASH:-없음}" "${HOST_NODES:-?}"
printf "    wasm  hash=%-10s nodes=%s\n" "${WASM_HASH:-없음}" "${WASM_NODES:-?}"
echo "----------------------------------------------------------"
if [ -n "${HOST_HASH:-}" ] && [ "${HOST_HASH:-}" = "${WASM_HASH:-x}" ]; then
  echo "  ✅ 가설 확정 — 폭만 고정하면 wasm 과 네이티브가 같은 해시를 낸다."
  echo "     BENCH 해시 불일치는 엔진 차이가 아니라 size_t 폭의 그림자였다."
  VERDICT=confirmed
else
  echo "  ❌ 가설 기각 — 폭을 고정해도 다르다. eval/simd 의 WASM 분기를 봐야 한다."
  VERDICT=rejected
fi
echo "=========================================================="
mkdir -p "$ROOT/results"
cat > "$ROOT/results/hash-width-diag.json" <<JSON
{
  "patch": "hasher << nodes  ->  hasher << uint64_t(nodes)  (command/benchmark.cpp)",
  "verdict": "$VERDICT",
  "host": { "hash": "${HOST_HASH:-null}", "nodes": "${HOST_NODES:-null}" },
  "wasm": { "hash": "${WASM_HASH:-null}", "nodes": "${WASM_NODES:-null}" },
  "unpatchedReference": { "host": "e240ab16", "wasm": "4100a973", "nodes": "4391204" }
}
JSON
cat "$ROOT/results/hash-width-diag.json"
[ "$VERDICT" = confirmed ]
