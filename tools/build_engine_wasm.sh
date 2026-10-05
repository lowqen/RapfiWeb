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
# 변형·가중치 스위치. **기본값(둘 다 비움)은 SIMD 두 종·렌주 전용**이다.
#   EXTRA_VARIANTS     공백 구분. multi-simd128-relaxed / single-simd128-relaxed
#                      (-DUSE_WASM_SIMD_RELAXED=ON). **배포 릴리스는 둘 다 켠다**
#                      (engine-release.yml) — 같은 소스에서 NPS +23%, BENCH 해시 동일
#                      (docs/gomocalc-엔진-비교.md). 앱이 지원을 감지해 먼저 띄운다.
#   PRELOAD_SET=full   벤치 전용(bench-gomocalc.yml). upstream 프리로드(가중치 4종, 40.3MB)를
#                      그대로 굽는다 — BENCH 국면 10개 중 7개가 프리스타일·스탠다드라서.
#                      25MB 를 넘어 배포 불가.
PRELOAD_SET="${PRELOAD_SET:-renju}"
EXTRA_VARIANTS="${EXTRA_VARIANTS:-}"
# 릴리스 태그 — engine-manifest.json 에 적힌다(engine-release.yml 이 넘긴다).
RELEASE_TAG="${RELEASE_TAG:-}"
# 측정 전용 링크 플래그(예: --profiling-funcs — wasm 이름 섹션을 남겨 V8 CPU 프로파일에 함수
# 이름이 찍히게). **배포 빌드는 비워 둔다.** upstream LINK_FLAGS 보다 앞에 놓이지만, 이름 섹션
# 같은 순서 무관 플래그만 넣는다(-s 설정은 뒤의 upstream 값에 덮인다 — 아래 [3/6] 주석).
EXTRA_LDFLAGS="${EXTRA_LDFLAGS:-}"
# upstream 패치(공백 구분, 저장소 루트 기준 경로 — 예: tools/patches/p2-1-codebook-pipeline.patch).
# **기본값은 비움 = 패치 없음.** Phase 2 의 결과 불변 패치를 BENCH 해시로 판정할 때 켜고
# (docs/최적화-마스터플랜.md 1부 §4 Phase 2, engine-patch.yml), 채택된 것은 engine-release.yml 이 잡 env 로
# 넘긴다(P2-2 부터 — 릴리스 본문이 밝히고 패치 파일을 자산으로 함께 낸다). 적용한 패치는 ENGINE_VERSION.txt 에 적힌다.
RAPFI_PATCHES="${RAPFI_PATCHES:-}"
# .wasm 후처리 패스(예: "-O4 --converge" — docs/최적화-마스터플랜.md 2-i · P2-6). **기본값은 비움 = 하지
# 않음.** emcc 가 링크 때 이미 wasm-opt 를 돌리므로 이것은 그 위에 얹는 추가 패스다. 켜면 [4.5/6] 에서
# 변형마다 그 변형이 쓰는 기능만 켜고 돌린다(wasm_features). 적용 여부는 ENGINE_VERSION.txt 에 적힌다.
WASM_OPT_POST="${WASM_OPT_POST:-}"

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
# emscripten 의 JS 도구(acorn-optimizer 등)는 upstream/emscripten/node_modules 의 npm 패키지를 쓴다.
# 설치가 중간에 끊긴 emsdk(오래 사는 self-hosted 작업 폴더 · 덜 저장된 캐시)는 emcc 는 있어도 이 폴더가
# 비어, 컴파일은 다 되고 **링크의 JS 최적화 단계에서** `Cannot find package 'acorn'` 으로 죽는다
# (engine-release 37254304022). 없으면 emsdk 가 쓰는 node/npm 으로 채운다.
EM_DIR="$(dirname "$(command -v emcc)")"
if [ ! -d "$EM_DIR/node_modules/acorn" ]; then
  echo "  ! $EM_DIR/node_modules 가 비었습니다 — npm 으로 채웁니다"
  ( cd "$EM_DIR" && { npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund; } )
  [ -d "$EM_DIR/node_modules/acorn" ] || { echo "  X emscripten npm 패키지를 채우지 못했습니다"; exit 1; }
fi
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

# 엔진 소스를 커밋 그대로 되돌린다 — 캐시된 작업 트리에 앞선 런의 패치가 남아 있을 수 있다
# (checkout 은 수정된 파일을 그대로 둔다). 빌드 디렉터리는 추적되지 않아 건드리지 않는다.
git checkout -q -- Rapfi
PATCH_NOTE="패치 없음"
if [ -n "$RAPFI_PATCHES" ]; then
  applied=()
  for p in $RAPFI_PATCHES; do
    if ! git apply --check "$ROOT/$p" 2> /dev/null; then
      echo "  X 패치가 $(git rev-parse --short HEAD) 에 적용되지 않습니다: $p"
      git apply --check "$ROOT/$p" || true
      exit 1
    fi
    git apply "$ROOT/$p"
    applied+=("$(basename "$p")")
    echo "  . 패치 적용: $p"
  done
  git diff --stat -- Rapfi | sed "s/^/  | /"
  PATCH_NOTE="패치: ${applied[*]}"
fi

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

echo ">>> [2.5/6] 프리로드 축소 — **렌주 전용**"
#
# upstream 은 mix9svq 가중치 4종(프리스타일·스탠다드·렌주 흑/백)을 전부 .data 에 굽는다.
# 40.3MB 다. Cloudflare Pages 는 **파일 하나가 25MB 를 넘으면 거부**하므로 그대로는
# 배포가 안 된다.
#
# 이 웹앱은 렌주 전용이라 렌주 가중치만 남긴다:
#
#   mix9svqrenju_bs15_black.bin.lz4    9,984,172
#   mix9svqrenju_bs15_white.bin.lz4    9,844,944
#   classical/model210901.bin             30,109   <- 아래 참고. 빼면 안 된다.
#   config.toml                            6,713
#                                     ─────────────
#                                       ~19.9MB
#
# **model210901.bin 은 남긴다.** 「classical 은 렌주와 무관하니 빼라」가 자연스러운
# 판단이지만, config 최상단이 이 파일을 이름으로 가리킨다:
#
#     [model]
#     binary_file = "model210901.bin"
#
# 빼면 config 로드에서 걸린다. 30KB 라 크기에도 영향이 없다.
# 안 쓰이는 model220723.bin(77KB)과 classical 전용 config 두 개는 뺀다.
#
# 프리로드 목록이 CMakeLists 가 아니라 **Networks 의 데이터 파일**이라는 점이
# 이걸 값싸게 만든다 — 엔진 소스에는 손대지 않는다.
cd "$WORK/rapfi"
if [ "$PRELOAD_SET" = "full" ]; then
  # 벤치 전용. 캐시된 소스에는 앞선 렌주 빌드가 덮어쓴 목록이 남아 있을 수 있으므로
  # upstream 원본으로 되돌린다.
  git -C Networks checkout -- wasm_preloads.txt
  echo "  . PRELOAD_SET=full — upstream 프리로드 그대로(가중치 4종). **배포 금지**(25MB 초과)"
  sed "s/^/  | /" Networks/wasm_preloads.txt
else
cat > Networks/wasm_preloads.txt << 'PRELOADS'
config-example/rapfiweb-renju.toml@config.toml
classical/model210901.bin@/
mix9svq/mix9svqrenju_bs15_black.bin.lz4@/
mix9svq/mix9svqrenju_bs15_white.bin.lz4@/
PRELOADS

# 렌주 전용 config. upstream 것에서 **프리스타일·스탠다드 가중치 항목만** 지운다.
#
# 항목을 남겨 두고 파일만 빼도 되지 않겠느냐 — 아마 그럴 것이다(엔진이 규칙에 맞는
# 항목을 고르므로). 하지만 "아마"로 40분짜리 빌드를 돌릴 이유가 없다. 없는 파일을
# 가리키는 줄은 남기지 않는다.
python3 - << 'PY'
import re, pathlib
src = pathlib.Path("Networks/config-example/gomocalc-mix9svq.toml").read_text(encoding="utf-8")
before = src
# weight_file = "…freestyle…" / "…standard…" 를 담은 [[…weights]] 블록만 제거
src = re.sub(
    r'\[\[model\.evaluator\.weights\]\]\s*\nweight_file = "mix9svq(?:freestyle_bsmix|standard_bs15)\.bin\.lz4"\s*\n',
    "",
    src,
)
assert src != before, "가중치 항목을 못 찾았습니다 — upstream config 가 바뀌었습니다"
assert "renju_bs15_black" in src, "렌주 항목이 사라졌습니다"
assert "freestyle" not in src.split("[search]")[0], "프리스타일 항목이 남아 있습니다"
pathlib.Path("Networks/config-example/rapfiweb-renju.toml").write_text(src, encoding="utf-8")
print("  . rapfiweb-renju.toml 생성 — 가중치 항목 1개(렌주 흑/백)만 남음")
PY
grep -A3 "model.evaluator.weights" Networks/config-example/rapfiweb-renju.toml | sed "s/^/  . /"
fi

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
  local name=$1 threads=$2 relaxed=${3:-OFF}
  local dir="build-$name"
  local extra=()
  [ "$threads" = "ON" ] || extra+=(-DNO_MULTI_THREADING=ON)

  echo "--- build: $name (threads=$threads relaxed=$relaxed) ---"
  emcmake cmake -S . -B "$dir" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DNO_COMMAND_MODULES=ON \
    -DUSE_WASM_SIMD=ON \
    -DUSE_WASM_SIMD_RELAXED="$relaxed" \
    -DCMAKE_EXE_LINKER_FLAGS="$EXTRA_LDFLAGS" \
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

# 추가 변형(EXTRA_VARIANTS) — relaxed SIMD. 이름이 곧 설정이다.
VARIANTS=(single-simd128 multi-simd128)
for v in $EXTRA_VARIANTS; do
  case "$v" in
    multi-simd128-relaxed)  build_variant "$v" ON ON ;;
    single-simd128-relaxed) build_variant "$v" OFF ON ;;
    *) echo "  X 모르는 변형: $v"; exit 1 ;;
  esac
  VARIANTS+=("$v")
done

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
for n in "${VARIANTS[@]}"; do collect "$n"; done

# ── [4.5/6] wasm-opt 후처리(선택) ─────────────────────────────────────────────
#
# **기능 플래그는 빌드 타깃마다 명시한다.** emcc 는 배포 빌드에서 target_features 섹션을 지우므로
# wasm-opt 는 모듈이 무엇을 쓰는지 모른다. 그래서 --mvp-features 에서 출발해 그 변형이 실제로 쓰는
# 기능만 켠다 — 빠지면 입력 검증에서 크게 실패하고(조용히 깨진 바이너리가 나오지 않는다), 켜지
# 않은 기능은 최적화가 새로 끼워 넣을 수 없다(브라우저 지원 범위를 넓히지 않는다).
#
# 목록은 배포 4변형에서 잰 것이다(2026-10-03, binaryen 133): 기능을 하나씩 끄고 검증해 깨지는 것.
#   공통   simd · sign-ext · nontrapping-float-to-int · reference-types · bulk-memory-opt
#   멀티   + threads · bulk-memory (passive 세그먼트 memory.init)
#   relaxed + relaxed-simd
# exception-handling 은 쓰이지 않는다(끄고도 검증이 통과한다).
wasm_features () {
  local f=(--mvp-features --enable-simd --enable-sign-ext --enable-nontrapping-float-to-int
           --enable-reference-types --enable-bulk-memory-opt)
  case "$1" in multi-*) f+=(--enable-threads --enable-bulk-memory) ;; esac
  case "$1" in *-relaxed) f+=(--enable-relaxed-simd) ;; esac
  echo "${f[@]}"
}
WASM_OPT_NOTE="없음"
if [ -n "$WASM_OPT_POST" ]; then
  echo ">>> [4.5/6] wasm-opt 후처리: $WASM_OPT_POST"
  # emsdk 의 binaryen — emcc 가 링크 때 쓰는 바로 그 wasm-opt 다.
  WASM_OPT="${WASM_OPT:-$(dirname "$(command -v emcc)")/../bin/wasm-opt}"
  [ -x "$WASM_OPT" ] || { echo "  X wasm-opt 를 찾지 못했습니다: $WASM_OPT"; exit 1; }
  echo "  . $("$WASM_OPT" --version)"
  for n in "${VARIANTS[@]}"; do
    w="$OUT/engine/rapfi-$n.wasm"
    # shellcheck disable=SC2207
    feats=($(wasm_features "$n"))
    before="$(stat -c%s "$w")"
    t0=$(date +%s)
    # shellcheck disable=SC2086
    "$WASM_OPT" "${feats[@]}" $WASM_OPT_POST "$w" -o "$w.opt"
    # 출력도 같은 기능 집합으로 다시 읽어 검증한다(패스 없이 읽기만 — 실패하면 set -e 로 멈춘다).
    # 「no passes specified」 경고 한 줄은 정상이다.
    "$WASM_OPT" "${feats[@]}" "$w.opt" -o /dev/null
    mv "$w.opt" "$w"
    echo "  . $n: $before → $(stat -c%s "$w") bytes · $(( $(date +%s) - t0 ))s · ${feats[*]:1}"
  done
  WASM_OPT_NOTE="$WASM_OPT_POST ($("$WASM_OPT" --version | awk '{print $3}'))"
fi

# ── 공유 가중치 — 모든 변형이 `rapfi.data` 하나를 쓴다 ─────────────────────
#
# .data 는 프리로드 목록의 파일을 이어 붙인 것일 뿐이라 **변형·컴파일러와 무관하게 바이트까지
# 같아야** 한다. 앱은 그 한 파일을 받아(캐시·해시 검증) 글루에 `getPreloadedPackage` 로
# 넘긴다(src/engine/weights-cache.ts). 그러려면 두 가지가 참이어야 하고, 여기서 확인한다:
#   (1) 변형별 .data 의 SHA-256 이 모두 같다
#   (2) 글루마다 박힌 패키지 목록(`files:[…]` — 파일별 시작·끝 위치)이 모두 같다
# 하나라도 다르면 공유하면 안 된다 — 한 변형이 다른 변형의 위치로 가중치를 잘라 읽는다.
# 변형별 .data 도 out/engine 에 남긴다(spike 하네스·node-bench 가 글루 기본 경로로 읽는다).
DATA_SHA=""
DATA_LAYOUT=""
for n in "${VARIANTS[@]}"; do
  sha="$(sha256sum "$OUT/engine/rapfi-$n.data" | cut -d' ' -f1)"
  layout="$(grep -oE 'files:\[[^]]*\]' "$OUT/engine/rapfi-$n.js" | head -1)"
  if [ -z "$layout" ]; then
    echo "  X $n: 글루에서 패키지 목록(files:[…])을 찾지 못했습니다"
    exit 1
  fi
  if [ -z "$DATA_SHA" ]; then
    DATA_SHA="$sha"
    DATA_LAYOUT="$layout"
  elif [ "$sha" != "$DATA_SHA" ] || [ "$layout" != "$DATA_LAYOUT" ]; then
    echo "  X $n: .data 또는 패키지 목록이 다른 변형과 다릅니다 — 공유할 수 없습니다"
    echo "      sha $sha ≠ $DATA_SHA"
    exit 1
  fi
done
cp "$OUT/engine/rapfi-${VARIANTS[0]}.data" "$OUT/engine/rapfi.data"
DATA_SIZE="$(stat -c%s "$OUT/engine/rapfi.data")"
echo "  . rapfi.data (공유) $DATA_SIZE bytes · sha256 $DATA_SHA · 변형 ${#VARIANTS[@]}개가 같다"
# 앱이 커밋하는 매니페스트(src/engine/engine-manifest.json)의 원본. 변형 순서는 앱의 시도 순서.
{
  echo "{"
  echo "  \"tag\": \"${RELEASE_TAG:-unreleased}\","
  echo "  \"upstream\": \"$(git -C "$WORK/rapfi" rev-parse HEAD)\","
  echo "  \"data\": {"
  echo "    \"file\": \"rapfi.data\","
  echo "    \"size\": $DATA_SIZE,"
  echo "    \"sha256\": \"$DATA_SHA\""
  echo "  },"
  echo "  \"variants\": ["
  first=1
  for v in multi-simd128-relaxed multi-simd128 single-simd128-relaxed single-simd128; do
    printf '%s\n' "${VARIANTS[@]}" | grep -qx "$v" || continue
    [ $first -eq 1 ] || echo ","
    printf '    "%s"' "$v"
    first=0
  done
  echo
  echo "  ]"
  echo "}"
} > "$OUT/engine/engine-manifest.json"
sed "s/^/  | /" "$OUT/engine/engine-manifest.json"

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
  # relaxed 는 이름과 플래그가 짝이어야 한다 — 앱은 이름을 보고 relaxed 를 아는 브라우저에만 준다.
  case "$name" in
    *-relaxed) grep -q -- "-mrelaxed-simd" "$nj" || { echo "  X relaxed 변형인데 -mrelaxed-simd 가 없다"; fail=1; } ;;
    *) grep -q -- "-mrelaxed-simd" "$nj" && { echo "  X 일반 변형인데 -mrelaxed-simd 가 있다(relaxed 를 모르는 브라우저가 못 읽는다)"; fail=1; } ;;
  esac

  echo "  . js   $(stat -c%s "$OUT/engine/rapfi-$name.js") bytes"
  echo "  . wasm $(stat -c%s "$OUT/engine/rapfi-$name.wasm") bytes"
  echo "  . data $(stat -c%s "$OUT/engine/rapfi-$name.data") bytes"
  if [ "$fail" -ne 0 ]; then
    echo "검증 실패: $name"
    exit 1
  fi
  echo "  OK $name"
}
for n in "${VARIANTS[@]}"; do
  case "$n" in
    multi-*) verify "$n" ON ;;
    *) verify "$n" OFF ;;
  esac
done

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
  echo "engine     : Rapfi WebAssembly (SIMD ${#VARIANTS[@]}종)"
  echo "upstream   : $(git -C "$WORK/rapfi" rev-parse HEAD)  (dhbloo/rapfi, $PATCH_NOTE)"
  echo "networks   : $(git -C "$WORK/rapfi/Networks" rev-parse HEAD)"
  echo "emscripten : $EMSDK_RESOLVED"
  echo "cmake opts : -DNO_COMMAND_MODULES=ON -DUSE_WASM_SIMD=ON -DUSE_WASM_SIMD_RELAXED=OFF(-relaxed 변형은 ON) -DCMAKE_BUILD_TYPE=Release"
  echo "data       : rapfi.data (모든 변형 공유) $DATA_SIZE bytes sha256 $DATA_SHA"
  echo "link opts  : (upstream CMakeLists 의 EMSCRIPTEN 블록이 전부 정한다 — 우리는 얹지 않는다)"
  echo "wasm-opt   : 추가 후처리 $WASM_OPT_NOTE"
  echo "variants   : ${VARIANTS[*]}"
  echo "preloads   : $PRELOAD_SET"
  echo "note       : SIMD 없는 변형은 eval/mix10nnue.cpp 의 static_assert 때문에 이 커밋에서 빌드되지 않는다"
  echo "built_at   : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "build_by   : RapfiWeb/tools/build_engine_wasm.sh"
  echo "bench      : spike/node-bench.mjs 가 두 변형에서 Hash 를 뽑아 e240ab16 과 대조한다"
} > "$OUT/engine/ENGINE_VERSION.txt"
sed "s/^/  . /" "$OUT/engine/ENGINE_VERSION.txt"

echo ">>> [7/7] 호스트 기준선 — wasm 해시를 **무엇과** 비교할 것인가"
#
# 1차 측정에서 wasm 해시가 e240ab16 과 달랐다(4100a973). 원인 후보가 둘이었다:
#
#   (a) 설정이 다르다. 안드로이드 벤치는 config-example/config.toml 로 돌렸고,
#       wasm 빌드는 wasm_preloads.txt 에 따라 gomocalc-mix9svq.toml 을
#       /config.toml 로 굽는다. 설정이 다르면 해시는 당연히 다르다.
#   (b) wasm 엔진의 탐색이 네이티브와 실제로 다르다.
#
# 같은 커밋의 호스트 바이너리로 **두 config 를 각각** 돌려 (a) 를 배제했다 —
# 둘 다 e240ab16 이 나왔다. 남은 것은 (b) 다.
#
# 이제 (b) 를 다시 둘로 가른다:
#
#   (b1) 벡터 폭. 호스트는 AVX2(256bit) 로 자동 감지되고 wasm 은 128bit 다.
#        폰의 NEON 도 128bit 인데 e240ab16 이 나왔으므로 이미 약한 가설이지만,
#        x86 안에서 폭만 바꿔 직접 통제한다: -DUSE_SSE=ON -DUSE_AVX2=OFF.
#   (b2) wasm 전용 코드 경로(eval/simd/ 의 WASM 분기).
#
#   host(sse128) == e240ab16  이면 폭은 원인이 아니다 -> (b2) 로 좁혀진다.
#   host(sse128) == 4100a973  이면 폭이 원인이다 -> wasm 은 "128bit 결과"를 낼 뿐이고
#                                                  네이티브 128bit 도 같은 값을 낸다.
cd "$WORK/rapfi/Rapfi"

# 호스트가 무엇으로 잡혔는지 남긴다. 자동 감지라 러너에 따라 AVX2/AVX512 가 갈린다 —
# 기록이 없으면 나중에 이 숫자를 재현할 수 없다.
cmake -S . -B build-host -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DNO_COMMAND_MODULES=ON -DENABLE_LTO=ON \
  2>&1 | tee "$OUT/bench/host-native-isa.txt" | grep -E "SSE:|AVX2:|AVX512:|BMI2:|VNNI:|NEON" | sed "s/^/  . 자동감지 /" || true
cmake --build build-host -j"$JOBS" > /dev/null
echo "  . 호스트 바이너리(자동 감지) 빌드 완료"

# (b1) 통제군: x86 을 128bit 로 묶는다. AVX2/AVX512/BMI2/VNNI 를 전부 끄고 SSE 만 켠다.
cmake -S . -B build-host-sse128 -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DNO_COMMAND_MODULES=ON -DENABLE_LTO=ON \
  -DUSE_SSE=ON -DUSE_AVX2=OFF -DUSE_AVX512=OFF -DUSE_BMI2=OFF -DUSE_VNNI=OFF \
  2>&1 | tee "$OUT/bench/host-sse128-isa.txt" | grep -E "SSE:|AVX2:|AVX512:|BMI2:|VNNI:" | sed "s/^/  . sse128 /" || true
cmake --build build-host-sse128 -j"$JOBS" > /dev/null
echo "  . 호스트 바이너리(SSE 128bit) 빌드 완료"

run_host_bench () {
  local label=$1 cfg=$2 bin=$3
  local dir="$WORK/hostbench-$label"
  rm -rf "$dir"
  mkdir -p "$dir"
  # 엔진은 cwd 에서 config 와 가중치를 찾는다(--config 인자가 없다).
  cp "$cfg" "$dir/config.toml"
  cp "$WORK/rapfi/Networks/mix9svq/"*.bin.lz4 "$dir/"
  cp "$WORK/rapfi/Networks/classical/"*.bin   "$dir/"
  ( cd "$dir" && printf 'BENCH\nEND\n' | "$bin" > bench.txt 2>&1 ) || true
  local h
  h="$(grep -oE "Hash: [0-9a-f]+" "$dir/bench.txt" | tail -1 | awk '{print $2}')"
  echo "${h:-none}" > "$OUT/bench/host-$label.hash"
  echo "  . host($label): ${h:-없음}   config=$(basename "$cfg")"
  grep -E "Nodes:|Nodes/s:|Total Time" "$dir/bench.txt" | sed "s/^/      /" || true
}
HOST_BIN="$WORK/rapfi/Rapfi/build-host/pbrain-rapfi"
HOST_BIN_SSE="$WORK/rapfi/Rapfi/build-host-sse128/pbrain-rapfi"
run_host_bench android "$WORK/rapfi/Networks/config-example/config.toml"          "$HOST_BIN"
run_host_bench wasmcfg "$WORK/rapfi/Networks/config-example/gomocalc-mix9svq.toml" "$HOST_BIN"
run_host_bench sse128  "$WORK/rapfi/Networks/config-example/gomocalc-mix9svq.toml" "$HOST_BIN_SSE"

echo "----------------------------------------------------------"
echo "  기준선 요약 (wasm 해시는 spike/node-bench.mjs 가 잰다)"
for l in android wasmcfg sse128; do
  printf "    host(%-8s) = %s\n" "$l" "$(cat "$OUT/bench/host-$l.hash")"
done
echo "    web baseline  = $(sed -n 's/.*"single-simd128"[^\"]*"\([0-9a-f]*\)".*/\1/p' "$ROOT/spike/web-baseline.json")  (웹 전용 회귀 기준)"
echo "----------------------------------------------------------"

echo "=========================================================="
echo "완료: $OUT"
echo "=========================================================="
