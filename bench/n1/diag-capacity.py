"""N1 진단 — 관문 ① 탈락의 원인 가르기(마스터플랜 2부 §8.10).

    python bench/n1/diag-capacity.py <holdout.bin>   (n1-samples.yml 아티팩트의 samples/holdout.bin)

전역 64 특징의 정보 한계 vs 소형 망 용량/양자화.
보류 표본(위치 순서대로 기록됨)을 앞 90% / 뒤 10% 로 갈라(국면 단위에 가까운 분할) float MLP 를 학습한다."""
import os, sys, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import REC, softmax, winrate, to_value

a = np.fromfile(sys.argv[1], dtype=REC)
a = a[a["valid"] == 1]
n = len(a)
cut = int(n * 0.9)
X = a["g"].astype(np.float32) / 128
T = softmax(a["logit"].astype(np.float64)).astype(np.float32)
C = (a["classical"].astype(np.float32) / 400)[:, None]
rng = np.random.default_rng(0)


def run(name, X, widths, epochs=12, lr=2e-3, bs=2048):
    Xtr, Xte, Ttr, Tte = X[:cut], X[cut:], T[:cut], T[cut:]
    dims = [X.shape[1]] + widths + [3]
    W = [rng.normal(0, np.sqrt(2 / dims[i]), (dims[i], dims[i + 1])).astype(np.float32) for i in range(len(dims) - 1)]
    B = [np.zeros(d, np.float32) for d in dims[1:]]
    P = W + B
    m = [np.zeros_like(p) for p in P]
    v = [np.zeros_like(p) for p in P]
    t = 0
    steps = epochs * (len(Xtr) // bs)
    t0 = time.time()

    def fwd(x):
        hs = [x]
        for i in range(len(W)):
            z = hs[-1] @ W[i] + B[i]
            hs.append(np.maximum(z, 0) if i < len(W) - 1 else z)
        return hs

    for ep in range(epochs):
        idx = rng.permutation(len(Xtr))
        for s in range(0, len(idx) - bs + 1, bs):
            b = idx[s : s + bs]
            hs = fwd(Xtr[b])
            g = (softmax(hs[-1]) - Ttr[b]) / bs
            gW, gB = [None] * len(W), [None] * len(W)
            for i in reversed(range(len(W))):
                gW[i] = hs[i].T @ g
                gB[i] = g.sum(0)
                if i:
                    g = (g @ W[i].T) * (hs[i] > 0)
            t += 1
            cur = lr * 0.5 * (1 + np.cos(np.pi * t / steps))
            for j, (p, gr) in enumerate(zip(P, gW + gB)):
                m[j] = 0.9 * m[j] + 0.1 * gr
                v[j] = 0.999 * v[j] + 0.001 * gr * gr
                p -= cur * (m[j] / (1 - 0.9**t)) / (np.sqrt(v[j] / (1 - 0.999**t)) + 1e-8)
    pr = softmax(fwd(Xte)[-1].astype(np.float64))
    d = np.abs(winrate(pr) - winrate(Tte.astype(np.float64))) * 100
    mae = np.abs(to_value(winrate(pr)) - to_value(winrate(Tte.astype(np.float64)))).mean()
    print(f"{name:28s} 평균 {d.mean():.2f} · p90 {np.percentile(d,90):.2f} · p99 {np.percentile(d,99):.2f}%p · MAE {mae:.0f}  ({time.time()-t0:.0f}s)", flush=True)


print(f"표본 {n:,} → 학습 {cut:,} / 검증 {n-cut:,}")
run("64→64→64 (float)", X, [64, 64])
run("64→256→256 (float)", X, [256, 256])
run("64+고전 → 256→256 (float)", np.hstack([X, C]), [256, 256])
