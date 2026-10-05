# shellcheck shell=bash
# python3 가 emsdk 의 요구(3.10)보다 낮으면 독립 실행형 CPython 을 받아 PATH 앞에 두고 EMSDK_PYTHON 으로 알린다.
# **source 해서 쓴다**(build_engine_wasm.sh 가 emsdk 를 쓰기 전에).
#
# 왜: RunPod self-hosted 러너(Ubuntu 20.04 계열)의 python3 가 3.8.10 이라 emsdk 가
# 「emsdk requires python 3.10 or above」로 멈췄다(M3 SPRT 37339858228). 러너에 sudo 가 없을 수 있어 사용자 영역에
# python-build-standalone(astral-sh) 의 install_only 판을 받는다.
#
#   source "$ROOT/tools/ci/ensure-python.sh"

__ensure_python() {
  local need="3.10" have=""
  if command -v python3 > /dev/null 2>&1; then
    have="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2> /dev/null || true)"
  fi
  if [ -n "$have" ] && [ "$(printf '%s\n%s\n' "$need" "$have" | sort -V | head -1)" = "$need" ]; then
    return 0
  fi
  local rel="20241016" v="3.12.7" a
  case "$(uname -m)" in
    x86_64) a=x86_64 ;;
    aarch64 | arm64) a=aarch64 ;;
    *) echo "python3 ${have:-없음} < $need 이고 아키텍처 $(uname -m) 의 바이너리를 모릅니다" >&2; return 1 ;;
  esac
  local dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/cpython-$v-$a"
  if [ ! -x "$dir/bin/python3" ]; then
    echo "  . python3 ${have:-없음} < $need — CPython $v(standalone)를 받습니다" >&2
    mkdir -p "$dir"
    local url="https://github.com/astral-sh/python-build-standalone/releases/download/$rel/cpython-$v+$rel-$a-unknown-linux-gnu-install_only.tar.gz"
    if command -v curl > /dev/null 2>&1; then
      curl -fsSL "$url" | tar -xz -C "$dir" --strip-components=1
    else
      node -e 'fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error(r.status);return r.arrayBuffer()}).then(b=>process.stdout.write(Buffer.from(b)))' "$url" \
        | tar -xz -C "$dir" --strip-components=1
    fi
  fi
  export PATH="$dir/bin:$PATH"
  export EMSDK_PYTHON="$dir/bin/python3"
  echo "  . python3 을 $dir/bin 으로 — $(python3 --version)" >&2
}
__ensure_python
unset -f __ensure_python
