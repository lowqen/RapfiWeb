# shellcheck shell=bash
# CMake 가 Rapfi 의 요구(3.18.2)보다 낮으면 공식 바이너리를 받아 PATH 앞에 둔다. **source 해서 쓴다**
# (빌드 스크립트 안에서 — 엔진을 짓는 워크플로가 열 개 남짓이라 하나하나 단계를 더하는 것보다 빠짐이 없다).
#
# 왜: RunPod self-hosted 러너(Ubuntu 20.04 계열 이미지)의 cmake 가 3.16.3 이라 M3 SPRT 의 빌드가
# 「CMake 3.18.2 or higher is required」로 멈췄다(sprt 37333419418). apt 의 cmake 는 20.04 에서 3.16 이 끝이고,
# 러너에 sudo 가 없을 수도 있어 사용자 영역에 받는다.
#
#   source "$(dirname "$0")/ci/ensure-cmake.sh"

__ensure_cmake() {
  local need="3.18.2" have=""
  if command -v cmake > /dev/null 2>&1; then
    have="$(cmake --version | sed -n '1s/[^0-9]*\([0-9][0-9.]*\).*/\1/p')"
  fi
  if [ -n "$have" ] && [ "$(printf '%s\n%s\n' "$need" "$have" | sort -V | head -1)" = "$need" ]; then
    return 0
  fi
  local v="3.30.5" a
  case "$(uname -m)" in
    x86_64) a=x86_64 ;;
    aarch64 | arm64) a=aarch64 ;;
    *) echo "cmake ${have:-없음} < $need 이고 아키텍처 $(uname -m) 의 바이너리를 모릅니다" >&2; return 1 ;;
  esac
  local dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/cmake-$v-linux-$a"
  if [ ! -x "$dir/bin/cmake" ]; then
    echo "  . cmake ${have:-없음} < $need — cmake $v 를 받습니다" >&2
    mkdir -p "$dir"
    local url="https://github.com/Kitware/CMake/releases/download/v$v/cmake-$v-linux-$a.tar.gz"
    if command -v curl > /dev/null 2>&1; then
      curl -fsSL "$url" | tar -xz -C "$dir" --strip-components=1
    else
      node -e 'fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error(r.status);return r.arrayBuffer()}).then(b=>process.stdout.write(Buffer.from(b)))' "$url" \
        | tar -xz -C "$dir" --strip-components=1
    fi
  fi
  export PATH="$dir/bin:$PATH"
  echo "  . cmake 를 $dir/bin 으로 — $(cmake --version | sed -n 1p)" >&2
}
__ensure_cmake
unset -f __ensure_cmake
