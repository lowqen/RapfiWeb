"""N1 진단 — 소형 헤드 입력이 담은 정보의 상한(float · 양자화 없음 · 넓은 망). 마스터플랜 2부 §8.10.

    python bench/n1/diag-capacity.py --train a.bin,b.bin --holdout h.bin [--configs "global:64,64;all:256,256"]
    python bench/n1/diag-capacity.py --holdout h.bin --rec 88 --configs "global:64,64;global:256,256"   (v1 재현)

--train 이 없으면 보류 파일 하나를 앞 90% / 뒤 10% 로 가른다(표본은 국면 순서로 기록되므로 국면 단위에 가까운 분할).
configs 는 「입력:폭,폭」을 ; 로 잇는다 — 입력 global = 전역 64 · all = 전역 64 + 구역 576 · +c 를 붙이면 고전 평가도 준다.
넓은 float 망으로도 p99 가 관문(5%p) 근처에 오지 않으면, 그 입력으로는 어떤 소형 헤드도 관문을 못 넘는다.
"""
import argparse, json, os, sys, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import RECS, features, load, softmax, to_value, winrate

ap = argparse.ArgumentParser()
ap.add_argument("--train", default="")
ap.add_argument("--holdout", required=True)
ap.add_argument("--rec", type=int, default=664, choices=sorted(RECS))
ap.add_argument("--limit", type=int, default=1_000_000, help="학습 표본 상한(0 = 전부)")
ap.add_argument("--epochs", type=int, default=10)
ap.add_argument("--configs", default="global:64,64;all:64,64;all:256,256;all+c:256,256")
ap.add_argument("--out", default="")
args = ap.parse_args()

rec = RECS[args.rec]
ho = load(args.holdout.split(","), 0, rec)
if args.train:
    tr = load(args.train.split(","), args.limit, rec)
else:
    cut = int(len(ho) * 0.9)
    tr, ho = ho[:cut], ho[cut:]
print(f"학습 {len(tr):,} · 검증 {len(ho):,}", flush=True)
rng = np.random.default_rng(0)


def inputs(a, spec):
    kind, _, extra = spec.partition("+")
    x = features(a, kind).astype(np.float32) / 128
    if extra == "c":
        x = np.hstack([x, (a["classical"].astype(np.float32) / 400)[:, None]])
    return x


def run(spec, widths, lr=2e-3, bs=2048):
    Xtr, Xte = inputs(tr, spec), inputs(ho, spec)
    Ttr = softmax(tr["logit"].astype(np.float64)).astype(np.float32)
    Tte = softmax(ho["logit"].astype(np.float64))
    dims = [Xtr.shape[1]] + widths + [3]
    W = [rng.normal(0, np.sqrt(2 / dims[i]), (dims[i], dims[i + 1])).astype(np.float32) for i in range(len(dims) - 1)]
    B = [np.zeros(d, np.float32) for d in dims[1:]]
    P = W + B
    m = [np.zeros_like(p) for p in P]
    v = [np.zeros_like(p) for p in P]
    t = 0
    steps = args.epochs * (len(Xtr) // bs)
    t0 = time.time()

    def fwd(x):
        hs = [x]
        for i in range(len(W)):
            z = hs[-1] @ W[i] + B[i]
            hs.append(np.maximum(z, 0) if i < len(W) - 1 else z)
        return hs

    for _ in range(args.epochs):
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
    d = np.abs(winrate(pr) - winrate(Tte)) * 100
    res = {
        "config": f"{spec}:{','.join(map(str, widths))}",
        "n_in": dims[0],
        "mean_pp": round(float(d.mean()), 3),
        "p90_pp": round(float(np.percentile(d, 90)), 3),
        "p99_pp": round(float(np.percentile(d, 99)), 3),
        "value_mae": round(float(np.abs(to_value(winrate(pr)) - to_value(winrate(Tte))).mean()), 1),
        "seconds": round(time.time() - t0),
    }
    print(
        f"{res['config']:24s} 입력 {dims[0]:3d} · 평균 {res['mean_pp']:.2f} · p90 {res['p90_pp']:.2f} · "
        f"p99 {res['p99_pp']:.2f}%p · MAE {res['value_mae']:.0f}  ({res['seconds']}s)",
        flush=True,
    )
    return res


results = []
for c in args.configs.split(";"):
    spec, _, w = c.partition(":")
    results.append(run(spec, [int(x) for x in w.split(",")]))
if args.out:
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"train": len(tr), "holdout": len(ho), "epochs": args.epochs, "results": results}, f, ensure_ascii=False, indent=2)
