# upstream 이슈 초안 (dhbloo/rapfi)

> 검토 후 제출. 제출하면 링크를 이 문서 맨 아래와 `docs/W0-결과.md` 에 기록한다.
> 본문은 영어로 쓴다(upstream 저장소의 언어).

---

## 이슈 1 — BENCH 해시 (제출 대상)

**제목** (사용자 지정)

```
WASM SIMD build produces different BENCH hash than native on same commit/config/node count
```

**대안 제목** — 진단(`tools/diag_hash_width.sh`)이 가설을 확정하면 이쪽이 더 정확하다:

```
BENCH hash is not comparable across 32-bit and 64-bit targets (size_t hashed by object representation)
```

### 본문

````markdown
## Summary

`BENCH` reports a different `Hash:` on a WebAssembly build than on a native x86-64 build,
even though both are built from the same commit, use the same config and the same network
weights, and search **exactly the same number of nodes**.

I believe the cause is not the engine at all, but how the benchmark hash is constructed:
`size_t` is hashed by object representation, and `sizeof(size_t)` is 4 on `wasm32` but 8 on
x86-64/arm64. If that is right, the hash cannot be compared across targets of different
pointer width by construction, and the values below are expected rather than a bug in the
evaluator or the search.

## Environment

| | |
|---|---|
| Commit | `3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7` |
| Networks | `e32ad77a5364363b3e3a02b3f9e8610ade19ea98` (submodule, unmodified) |
| Config | `Networks/config-example/gomocalc-mix9svq.toml` (`default_thread_num = 1`) |
| Native | Ubuntu 24.04 x86-64, GCC, `-DCMAKE_BUILD_TYPE=Release -DNO_COMMAND_MODULES=ON -DENABLE_LTO=ON`, ISA auto-detected |
| WASM | Emscripten 6.0.8 (clang++ 24.0.0), `-DNO_MULTI_THREADING=ON -DUSE_WASM_SIMD=ON -DUSE_WASM_SIMD_RELAXED=OFF` |

No source patches on either side.

## Steps to reproduce

```bash
# in a directory containing config.toml (= gomocalc-mix9svq.toml), the mix9svq
# *.bin.lz4 weights and classical/*.bin
printf 'BENCH\nEND\n' | ./pbrain-rapfi
```

and the same `BENCH` / `END` pair driven through `Module.sendCommand()` from
`emscripten/preamble.js` for the WASM build.

## Observed

| Build | Nodes | Hash |
|---|---|---|
| native x86-64 (auto ISA / AVX2), `config-example/config.toml` | 4,391,204 | `e240ab16` |
| native x86-64 (auto ISA / AVX2), `gomocalc-mix9svq.toml` | 4,391,204 | `e240ab16` |
| native x86-64, `-DUSE_SSE=ON -DUSE_AVX2=OFF` (128-bit), `gomocalc-mix9svq.toml` | 4,391,204 | `e240ab16` |
| **wasm32 `single-simd128`**, same config (preloaded) | **4,391,204** | **`4100a973`** |

Three things worth stressing:

* **The two native configs give the same hash**, so this is not a configuration difference.
* **Restricting the native build to 128-bit vectors does not change the hash either.**
  `-DUSE_SSE=ON -DUSE_AVX2=OFF -DUSE_AVX512=OFF -DUSE_BMI2=OFF -DUSE_VNNI=OFF` runs at
  132,596 n/s instead of 249,571 n/s — so it really is a different binary — and still
  prints `e240ab16`. The arm64 build (NEON, 128-bit) prints `e240ab16` as well. Vector
  width is not the variable here.
* **The node count is identical to the digit** across all builds, so the search visited the
  same tree. A genuine evaluation difference would be expected to change pruning and
  therefore the node count.

## Independent evidence that `size_t` is the variable

The very next line of `runBenchmark` overflows on the WASM build, and the overflow
is exactly a 32-bit one:

```cpp
MESSAGEL("Nodes/s: " << searchNodes * 1000 / std::max<size_t>(duration, 1));
```

| Build | Nodes | Total Time (ms) | Expected | Printed |
|---|---|---|---|---|
| native | 4,391,204 | 17,478 | 251,241 | 251,241 |
| native (SSE 128-bit) | 4,391,204 | 33,117 | 132,596 | 132,596 |
| **wasm32** | 4,391,204 | 73,107 | 60,065 | **1,316** |

```
4,391,204 * 1000 = 4,391,204,000
                 -  4,294,967,296   (2^32)
                 =     96,236,704
96,236,704 / 73,107 = 1,316.4  ->  1316     <- exactly what the WASM build prints
```

A second run with `duration = 73,341` printed `1312`, which the same arithmetic also
reproduces exactly. So `searchNodes` is demonstrably 32 bits wide in the WASM build,
which is the same property that makes `hasher << nodes` feed 4 bytes instead of 8.

## Analysis

`Rapfi/command/benchmark.cpp`:

```cpp
size_t nodes = Search::Engine.nodesSearched();
searchNodes += nodes;
// Hash from nodes searched
hasher << nodes;
// Hash from the last output eval
hasher << Search::Engine.main()->rootMoves[0].value;
```

`Rapfi/core/hash.h`:

```cpp
template <typename T>
XXHasher &operator<<(const T &v)
{
    static_assert(std::is_trivially_copyable_v<T>, "XXHasher hashes the object representation");
    XXH64_update(state, static_cast<const void *>(&v), sizeof(T));
    return *this;
}
```

`hasher << nodes` feeds `sizeof(size_t)` bytes. That is **8 bytes on x86-64 and arm64, but
4 bytes on wasm32**. `rootMoves[0].value` is a `Value` (an `int`), which is 4 bytes on both,
so the node count is the only width-varying input — and it is fed once per benchmark
position. So the two targets hash different byte streams even when every value agrees.

## Suggested fix

Hash a fixed-width type so the digest is target-independent:

```diff
-    hasher << nodes;
+    hasher << uint64_t(nodes);
```

(and, if you want the digest fully specified, `int32_t(...)` for the value as well.)

The `Nodes/s` line above has the same root cause and can be fixed alongside it:

```diff
-    MESSAGEL("Nodes/s: " << searchNodes * 1000 / std::max<size_t>(duration, 1));
+    MESSAGEL("Nodes/s: " << uint64_t(searchNodes) * 1000 / std::max<uint64_t>(duration, 1));
```

This changes the published reference hash once, but makes it meaningful as a
cross-platform check — which is how downstream users treat it. For context: the Android
build of this engine uses "the arm64 build reproduces the x86-64 `BENCH` hash" as its
release gate, on the reasoning that `-ffp-contract=off` makes search results independent of
the instruction set. That gate works between arm64 and x86-64 (both LP64) but silently
cannot work for wasm32.

## Verification

I can confirm or refute this locally: patch the single line above, rebuild both native and
wasm from the same tree, and compare. I will post the result here.
````

### 제출 후 확인할 것

- 진단이 **확정**이면: 위 본문의 «Verification» 자리에 결과를 붙이고, 우리 문서에서
  «부동소수점 구현 차이» 라는 설명을 **전부 걷어낸다** — 사실이 아니게 되기 때문이다.
  사용자 고지 문구도 함께 고쳐야 한다(§8).
- 진단이 **기각**이면: 이 이슈는 그대로 유효하되 원인 분석 문단을 «가설이었으나 기각됨»
  으로 바꾸고 `eval/simd/` 의 WASM 분기 조사를 이어간다.

---

## 이슈 2 — 비SIMD wasm 빌드 (별도, 낮은 우선순위)

README 는 wasm 4종(`single`, `single-simd128`, `multi`, `multi-simd128`)을 안내하지만,
이 커밋에서 SIMD 없는 두 종은 컴파일되지 않는다.

```
Rapfi/eval/mix10nnue.cpp:256:
  static_assert(InstType != simd::InstructionType::SCALAR, ...)
```

`mix10nnue.cpp` 는 `CORE_SOURCES` 에 무조건 들어가고 빼는 CMake 옵션이 없어서,
`USE_WASM_SIMD=OFF` 로는 링크까지 갈 수 없다. 문서를 고치거나(4종 → 2종) 스칼라
폴백을 넣는 선택지가 있을 텐데, 실사용 영향은 **Safari 16.4 미만(iOS)** 정도라
우선순위는 낮아 보인다. 우리는 SIMD 를 하한선으로 잡고 진행한다.

---

## 제출 기록

| 이슈 | 상태 | 링크 |
|---|---|---|
| 1. BENCH 해시 | 미제출(검토 대기) | — |
| 2. 비SIMD 빌드 | 미제출 | — |
