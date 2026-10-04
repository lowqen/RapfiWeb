#!/usr/bin/env bash
#
# WASM LLVM PGO 빌드 (P3-5) — 계측 빌드 → Node 훈련 → llvm-profdata merge → 프로파일 사용 빌드.
# 엔진 코드는 건드리지 않는다: tools/build_engine_wasm.sh 의 PGO_GENERATE / PGO_PROFILE 컴파일 · 링크 플래그뿐이다.
#
#   RAPFI_PATCHES="…" WASM_OPT_POST="-O4 --converge" bash tools/build_engine_wasm_pgo.sh
#
# 나머지 환경 변수(RAPFI_PATCHES · WASM_OPT_POST · BASE_VARIANTS · EXTRA_VARIANTS · ENABLE_LTO …)는 **마지막(사용) 빌드**에
# 그대로 넘어간다. 계측 빌드는 훈련에 쓰는 single-simd128 하나만, wasm-opt 후처리 없이 만든다.
#   PGO_TRAIN_NODES   국면당 노드(기본 200000) · PGO_TRAIN_POSITIONS  국면 파일들(train.mjs 기본)
#   PGO_TRAIN_LIMIT   훈련 국면 수 상한(진단용) · PGO_STOP_AFTER_TRAIN=1  훈련 뒤 멈춤(진단 — 프로파일 꺼내기만 확인)
#   PGO_GEN_CFLAGS · PGO_GEN_LDFLAGS  계측 빌드에만 더할 플래그(예: -mllvm -disable-vp=true · --profiling-funcs)
# 산출물: out/engine(PGO 빌드) + out/pgo/{rapfi.profdata, rapfi.profraw, train.log, profdata-show.txt}
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${WORK:-$HOME/rapfi-wasm-work}"
PGO_DIR="$WORK/pgo"
rm -rf "$PGO_DIR"
mkdir -p "$PGO_DIR/inst"

echo "=========================================================="
echo " PGO 1/4 — 계측 빌드(single-simd128, -fprofile-instr-generate)"
echo "=========================================================="
PGO_GENERATE=1 PGO_PROFILE="" BASE_VARIANTS=single-simd128 EXTRA_VARIANTS="" WASM_OPT_POST="" \
  EXTRA_LDFLAGS="${PGO_GEN_LDFLAGS:-}" bash "$ROOT/tools/build_engine_wasm.sh"
cp "$ROOT"/out/engine/rapfi-single-simd128.* "$ROOT/out/engine/package.json" "$PGO_DIR/inst/"
grep -E "^(upstream|pgo) " "$ROOT/out/engine/ENGINE_VERSION.txt" | sed "s/^/  | /"

# llvm-profdata 는 **emsdk 의 clang 과 같은 LLVM** 이어야 한다(.profraw 형식 판이 LLVM 마다 다르다).
PROFDATA="$WORK/emsdk/upstream/bin/llvm-profdata"
if [ ! -x "$PROFDATA" ]; then
  echo "  X emsdk 에 llvm-profdata 가 없습니다: $PROFDATA"
  ls "$WORK/emsdk/upstream/bin" | sed "s/^/    /"
  exit 1
fi
echo "  . $("$PROFDATA" --version 2>&1 | grep -i version | head -1)"
echo "  . clang: $("$WORK/emsdk/upstream/bin/clang" --version | head -1)"

echo "=========================================================="
echo " PGO 2/4 — 훈련(Node, 계측 WASM)"
echo "=========================================================="
(
  cd "$ROOT"
  posArgs=()
  [ -n "${PGO_TRAIN_POSITIONS:-}" ] && posArgs=(--positions "$PGO_TRAIN_POSITIONS")
  [ -n "${PGO_TRAIN_LIMIT:-}" ] && posArgs+=(--limit "$PGO_TRAIN_LIMIT")
  RAPFI_PROFRAW="$PGO_DIR/rapfi.profraw" node tools/pgo/train.mjs --dir "$PGO_DIR/inst" \
    --nodes "${PGO_TRAIN_NODES:-200000}" "${posArgs[@]}" 2>&1 | tee "$PGO_DIR/train.log"
)
if [ ! -s "$PGO_DIR/rapfi.profraw" ]; then
  echo "  X 프로파일(.profraw)이 없거나 비었습니다 — profdump.js(onExit)가 돌지 않았다"
  exit 1
fi
echo "  . profraw $(stat -c%s "$PGO_DIR/rapfi.profraw") bytes"
if [ -n "${PGO_STOP_AFTER_TRAIN:-}" ]; then
  "$PROFDATA" merge -o "$PGO_DIR/rapfi.profdata" "$PGO_DIR/rapfi.profraw" && "$PROFDATA" show "$PGO_DIR/rapfi.profdata" | sed "s/^/  | /"
  echo "PGO_STOP_AFTER_TRAIN — 여기서 멈춘다"
  exit 0
fi

echo "=========================================================="
echo " PGO 3/4 — llvm-profdata merge"
echo "=========================================================="
"$PROFDATA" merge -o "$PGO_DIR/rapfi.profdata" "$PGO_DIR/rapfi.profraw"
"$PROFDATA" show "$PGO_DIR/rapfi.profdata" | tee "$PGO_DIR/profdata-show.txt" | sed "s/^/  | /"
# 훈련이 핫패스에 닿았는지 — 가장 뜨거운 함수 몇 개(NNUE · 탐색이어야 한다)
"$PROFDATA" show --topn=12 "$PGO_DIR/rapfi.profdata" 2>/dev/null | tail -14 | sed "s/^/  | /" || true

echo "=========================================================="
echo " PGO 4/4 — 프로파일 사용 빌드(-fprofile-instr-use)"
echo "=========================================================="
PGO_GENERATE="" PGO_PROFILE="$PGO_DIR/rapfi.profdata" bash "$ROOT/tools/build_engine_wasm.sh"
mkdir -p "$ROOT/out/pgo"
cp "$PGO_DIR/rapfi.profdata" "$PGO_DIR/rapfi.profraw" "$PGO_DIR/train.log" "$PGO_DIR/profdata-show.txt" "$ROOT/out/pgo/"
grep -E "^(upstream|wasm-opt|pgo) " "$ROOT/out/engine/ENGINE_VERSION.txt" | sed "s/^/  | /"
echo "완료: out/engine(PGO) · out/pgo/"
