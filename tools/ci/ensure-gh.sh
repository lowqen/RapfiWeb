#!/usr/bin/env bash
# GitHub CLI(gh)가 없는 러너에서 gh 를 받아 다음 단계부터 쓰게 한다(GITHUB_PATH).
#
# 왜: self-hosted 러너를 갓 띄운 컨테이너(RunPod 등)로 바꾸자 gh 가 없었고, deploy.yml 의 엔진 조립이
# `gh release view` 실패를 「릴리스가 없다」로 읽어 **가중치 없이 프로덕션에 배포했다**(deploy 37325146041 —
# 엣지 캐시가 남은 곳에서만 엔진이 떴다). 워크플로 쪽도 이제 읽기 실패를 실패로 다루지만, 도구는 여기서 채운다.
#
#   bash tools/ci/ensure-gh.sh        # 워크플로의 한 단계로 — 그 뒤 단계에서 gh 가 PATH 에 있다
set -euo pipefail

if command -v gh > /dev/null 2>&1; then
  echo "gh 있음 — $(gh --version | head -1)"
  exit 0
fi

V=2.62.0
case "$(uname -m)" in
  x86_64) A=amd64 ;;
  aarch64 | arm64) A=arm64 ;;
  *) echo "::error::gh: 모르는 아키텍처 $(uname -m)"; exit 1 ;;
esac
DIR="${RUNNER_TEMP:-/tmp}/gh-$V"
URL="https://github.com/cli/cli/releases/download/v$V/gh_${V}_linux_${A}.tar.gz"

if [ ! -x "$DIR/bin/gh" ]; then
  mkdir -p "$DIR"
  echo "gh 없음 — $URL 받는 중"
  if command -v curl > /dev/null 2>&1; then
    curl -fsSL "$URL" | tar -xz -C "$DIR" --strip-components=1
  else
    # curl 도 없는 최소 이미지 — setup-node 뒤라 node 의 fetch 로 받는다.
    node -e 'fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error(r.status);return r.arrayBuffer()}).then(b=>process.stdout.write(Buffer.from(b)))' "$URL" \
      | tar -xz -C "$DIR" --strip-components=1
  fi
fi

"$DIR/bin/gh" --version | head -1
if [ -n "${GITHUB_PATH:-}" ]; then echo "$DIR/bin" >> "$GITHUB_PATH"; fi
