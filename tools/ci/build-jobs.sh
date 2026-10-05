# shellcheck shell=bash
# 병렬 빌드 수(JOBS) — 코어 수와 **실제로 쓸 수 있는 메모리** 중 작은 쪽. **source 해서 쓴다.**
#
# 왜: 컨테이너(RunPod 등)는 /proc/meminfo 에 호스트 전체 메모리가 보이지만 실제 상한은 cgroup 한도다. `nproc`(32)
# 그대로 LTO 컴파일러를 띄우면 그 한도를 넘겨 러너째 죽을 수 있다 — M3 SPRT(37334545362)가 빌드 단계에서 로그 없이
# 「self-hosted runner lost communication」으로 끝났다. 작업 하나에 ~2GB(LTO 링크는 더)로 잡고, 러너 프로세스의
# 하트비트 몫으로 코어를 남긴다. JOBS 를 미리 주면 그 값을 쓴다.
#
#   source "$ROOT/tools/ci/build-jobs.sh"   # → $JOBS

__build_jobs() {
  local cores bytes lim avail_kb per=$((2 * 1024 * 1024 * 1024)) bymem n
  cores="$(nproc 2> /dev/null || echo 2)"
  avail_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2> /dev/null || echo 0)"
  bytes=$((avail_kb * 1024))
  lim=""
  if [ -r /sys/fs/cgroup/memory.max ]; then
    lim="$(cat /sys/fs/cgroup/memory.max)"                       # cgroup v2 — 「max」면 한도 없음
  elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    lim="$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)"     # cgroup v1 — 한도 없음이면 아주 큰 수
  fi
  if [[ "$lim" =~ ^[0-9]+$ ]] && { [ "$bytes" -eq 0 ] || [ "$lim" -lt "$bytes" ]; }; then bytes="$lim"; fi
  # 메모리를 읽지 못하면(오래된 커널 · 리눅스 밖) 메모리로는 줄이지 않는다.
  if [ "$bytes" -gt 0 ]; then bymem=$((bytes / per)); else bymem="$cores"; fi
  [ "$bymem" -ge 1 ] || bymem=1
  n="$cores"
  # 러너 · 하트비트 몫 — 코어가 넉넉하면 둘, 아니면 하나를 남긴다.
  if [ "$n" -gt 8 ]; then n=$((n - 2)); elif [ "$n" -gt 2 ]; then n=$((n - 1)); fi
  [ "$n" -le "$bymem" ] || n="$bymem"
  echo "  . JOBS $n (코어 $cores · 메모리 $((bytes / 1024 / 1024 / 1024))GB ÷ 2GB = $bymem)" >&2
  echo "$n"
}
JOBS="${JOBS:-$(__build_jobs)}"
unset -f __build_jobs
