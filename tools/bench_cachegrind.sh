#!/usr/bin/env bash
#
# M1 — cachegrind 결정적 비용 지표 (docs/최적화-마스터플랜.md 2부 §4 M1).
#
#   BASE_PATCHES="tools/patches/p2-2-keep-evaluators-on-rebuild.patch" \
#   TEST_PATCHES="tools/patches/a1-q15mulr.patch" \
#   bash tools/bench_cachegrind.sh
#
# 하는 일:
#   1. 네이티브 엔진을 **WASM single-simd128 에 가장 가까운 꼴**로 빌드한다 — 128비트 SSE(-DUSE_SSE=ON, AVX 끔),
#      프리페치 없음(-DNO_PREFETCH=ON — WASM 에는 프리페치 명령이 없다), 단일 스레드(-DNO_MULTI_THREADING=ON).
#      A = BASE_PATCHES, B = BASE_PATCHES + TEST_PATCHES(비우면 A 만).
#   2. 엔진 × LL 크기마다 cachegrind 를 두 번(search · load) 돌린다 — 서로 독립이라 JOBS 개씩 나란히.
#      모의 캐시는 결정적이라 나란히 돌려도 값이 흔들리지 않는다(벽시계만 늘어난다).
#   3. A 의 첫 LL search 를 한 번 더 돌려 Ir 이 비트까지 같은지 본다(REPEAT_CHECK=1, 기본).
#   4. bench/cachegrind/report.mjs 로 보고서(OUT/report.md · summary.json).
#
# 리눅스 x86_64 + valgrind(≥ 3.22) + cmake/ninja/clang 또는 gcc + node 가 필요하다(.github/workflows/cachegrind.yml).
# WASM 의 코드 생성은 clang 네이티브와 다르므로 **명령 수의 절대값이 아니라 A/B 의 상대 변화와 메모리 행동**만 옮겨 쓴다.
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_PATCHES="${BASE_PATCHES-tools/patches/p2-2-keep-evaluators-on-rebuild.patch}"
TEST_PATCHES="${TEST_PATCHES:-}"
# 2의 거듭제곱(바이트). 4MB ≈ Celeron N4500 급 L3, 32MB ≈ 데스크톱 · 서버.
LL_SIZES="${LL_SIZES:-4194304 33554432}"
NODES="${NODES:-250000}"
COUNT="${COUNT:-12}"
POSITIONS="${POSITIONS:-bench/sprt/openings-balanced.json}"
OUT="${OUT:-bench/cachegrind/results/run}"
JOBS="${JOBS:-$(nproc 2> /dev/null || echo 2)}"
REPEAT_CHECK="${REPEAT_CHECK:-1}"
SKIP_BUILD="${SKIP_BUILD:-0}"
HOST_CMAKE_FLAGS="${HOST_CMAKE_FLAGS:--DUSE_SSE=ON -DUSE_AVX2=OFF -DUSE_AVX512=OFF -DUSE_BMI2=OFF -DUSE_VNNI=OFF -DNO_PREFETCH=ON -DNO_MULTI_THREADING=ON}"

command -v valgrind > /dev/null || { echo "  X valgrind 가 없습니다(apt-get install valgrind)"; exit 1; }
echo "  . $(valgrind --version) · JOBS=$JOBS · LL=[$LL_SIZES] · 노드 $NODES × 국면 $COUNT"
grep -m1 "model name" /proc/cpuinfo || true

E=bench/cachegrind/engines
if [ "$SKIP_BUILD" != "1" ]; then
  echo "--- [1/3] 빌드 A(base)"
  OUT_DIR="$E/base" RAPFI_PATCHES="$BASE_PATCHES" HOST_CMAKE_FLAGS="$HOST_CMAKE_FLAGS" bash tools/build_host_engine.sh
  if [ -n "$TEST_PATCHES" ]; then
    echo "--- [1/3] 빌드 B(test)"
    # shellcheck disable=SC2086
    OUT_DIR="$E/test" RAPFI_PATCHES="$(echo $BASE_PATCHES $TEST_PATCHES)" HOST_CMAKE_FLAGS="$HOST_CMAKE_FLAGS" \
      bash tools/build_host_engine.sh
  fi
fi
engines="base"
[ -n "$TEST_PATCHES" ] && engines="base test"

rm -rf "$OUT"
mkdir -p "$OUT"
jobs_file="$OUT/jobs.txt"
: > "$jobs_file"
first_ll="${LL_SIZES%% *}"
for eng in $engines; do
  for ll in $LL_SIZES; do
    for mode in search load; do
      echo "$eng $mode $ll" >> "$jobs_file"
    done
  done
done
[ "$REPEAT_CHECK" = "1" ] && echo "base search $first_ll rep2" >> "$jobs_file"

echo "--- [2/3] cachegrind $(wc -l < "$jobs_file")회 (나란히 $JOBS)"
export ROOT OUT NODES COUNT POSITIONS E
run_one () {
  set -eu
  eng="$1"; mode="$2"; ll="$3"; rep="${4:-}"
  name="$eng-$mode-$ll${rep:+-$rep}"
  node "$ROOT/bench/cachegrind/cg-run.mjs" --engine-dir "$ROOT/$E/$eng" --mode "$mode" --ll "$ll" \
    --positions "$POSITIONS" --count "$COUNT" --nodes "$NODES" --out "$OUT/$name.json" > "$OUT/$name.log" 2>&1 \
    || { echo "  X $name 실패 — $OUT/$name.log"; tail -20 "$OUT/$name.log"; return 1; }
  tail -1 "$OUT/$name.log"
}
export -f run_one
xargs -P "$JOBS" -L 1 bash -c 'run_one "$@"' _ < "$jobs_file"

echo "--- [3/3] 보고"
node bench/cachegrind/report.mjs "$OUT" --json "$OUT/summary.json" | tee "$OUT/report.md"
for eng in $engines; do
  echo "  . $eng: $(grep -oE "Hash: [0-9a-f]+" "$E/$eng/bench.txt" | tail -1 || true) · $(grep patches "$E/$eng/ENGINE_VERSION.txt")"
done
