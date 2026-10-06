#!/usr/bin/env python3
"""
N1 — 소형 값 헤드 증류(학습 · 평가 · 내보내기). 마스터플랜 2부 §3.2.

입력: tools/patches/n1-value-dump.patch 를 얹은 네이티브 엔진이 탐색하며 쓴 표본(v2 664바이트 줄 · v1 88바이트는 --rec 88).
  전역 특징 int8[64](대형 값 헤드의 layer0[0:64]) · 3×3 구역 특징 int8[9][64](group0 — starBlock 앞단, v2 만) ·
  대형 헤드 로짓(승 · 패 · 무) · 그 호출의 고전 평가 · α · β · 수 번호.

모델: 입력(--inputs global = 64 · all = 640) → 64 → 64 → 3. **엔진의 정수 추론을 그대로 흉내 낸다**(양자화 인식 학습):
  x = 입력 int8 / 128
  h1 = floor(clip(W1 x + b1, 0, 127/128) · 128) / 128     ← simd::crelu<64, 128>(int32 / 128 → [0, 127])
  h2 = 같은 식(W2, b2)
  로짓 = W3 h2 + b3                                        ← int32 / (128 · 128)
  W 는 int8 / 128(1/128 단위, [-1, 127/128]), b 는 int32 / 16384.
  반올림 · 내림은 앞으로만 하고 기울기는 그대로 흘린다(STE) — 가중치를 그대로 엔진에 실으면 같은 출력이 나온다.

손실: 대형 헤드의 softmax 를 교사로 한 교차 엔트로피(= KL + 상수).

평가(보류 표본, 사전 등록 관문 ①): 승률(승 + ½무) 차 — 평균 · p50 · p90 · p99 · 최대(%p).
그리고 분기 규칙별 「소형 헤드로 돌릴 몫 r」과 그 몫에서의 오차 · α-β 판단 불일치:
  - classical:<s>  고전 평가가 창 ± (좁은 여유 s) 밖이면 소형(계획서의 3단 분기). s=395 가 지금의 넓은 여유와 같다.
  - small:<m>      소형 헤드의 값이 창 ± m 밖이면 소형, 아니면 대형(소형이 스스로 가르는 꼴 — Stockfish 이중 NNUE 식).
  「판단 불일치」 = 소형을 쓴 호출 중 소형 값과 대형 값이 α-β 창에 대해 다른 쪽에 있는 비율(낮음 · 안 · 높음).

  python3 bench/n1/train.py --train a.bin,b.bin --holdout h.bin --out bench/n1/out [--epochs 6]
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

_TAIL = [
    ("logit", "<f4", 3),
    ("classical", "<i2"),
    ("alpha", "<i2"),
    ("beta", "<i2"),
    ("ply", "<i2"),
    ("valid", "u1"),
    ("res", "u1", 3),
]
# v1(N1, 88바이트) — 전역 특징만. v2(N1b, 664바이트) — 3×3 구역 특징(group0, 행 우선 9 × 64)을 더했다.
REC_V1 = np.dtype([("g", "i1", 64)] + _TAIL)
REC_V2 = np.dtype([("g", "i1", 64), ("grp", "i1", 576)] + _TAIL)
assert REC_V1.itemsize == 88 and REC_V2.itemsize == 664
REC = REC_V2
RECS = {88: REC_V1, 664: REC_V2}

SCALING = 200.0  # eval/scoretables.h ScalingFactor — 값 = 200 · logit(승률)
VALUE_EVAL_MAX = 30000


def load(paths, limit=0, rec=REC):
    arrs = [np.fromfile(p, dtype=rec) for p in paths if p and os.path.getsize(p) > 0]
    a = np.concatenate(arrs) if arrs else np.zeros(0, rec)
    a = a[a["valid"] == 1]
    if limit and len(a) > limit:
        a = a[np.random.default_rng(1).choice(len(a), limit, replace=False)]
    return a


def features(a, inputs):
    """소형 헤드 입력(int8). global = 전역 64 · all = 전역 64 + 구역 576(엔진의 layer0[0:64] 와 group0 를 이어 붙인 순서)."""
    if inputs == "global":
        return np.ascontiguousarray(a["g"])
    if inputs == "all":
        return np.concatenate([a["g"], a["grp"]], axis=1)
    raise ValueError(inputs)


def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def winrate(p):
    return p[:, 0] + 0.5 * p[:, 2]


def to_value(w):
    w = np.clip(w, 1e-6, 1 - 1e-6)
    return np.clip(SCALING * np.log(w / (1 - w)), -VALUE_EVAL_MAX, VALUE_EVAL_MAX)


def margin(c, scale):
    """eval.cpp classicalEvalMargin — marginWinLossScale 1.18 · 지수 3.07(기본 config)."""
    wl = 2.0 * (1.0 / (1.0 + np.exp(-c / SCALING)) - 0.5)
    x2 = (1.18 * wl) ** 2
    return scale * np.exp(-np.power(x2, 3.07))


# ── 양자화 ──────────────────────────────────────────────────────────────
def qw(w):
    return np.clip(np.round(w * 128), -128, 127) / 128


def qb(b):
    return np.round(b * 16384) / 16384


class Net:
    def __init__(self, rng, n_in=64):
        def init(o, i):
            lim = math.sqrt(6.0 / i)
            return rng.uniform(-lim, lim, (o, i)).astype(np.float32) * 0.5

        self.p = {
            "W1": init(64, n_in),
            "b1": np.full(64, 0.05, np.float32),
            "W2": init(64, 64),
            "b2": np.full(64, 0.05, np.float32),
            "W3": init(3, 64),
            "b3": np.zeros(3, np.float32),
        }
        self.m = {k: np.zeros_like(v) for k, v in self.p.items()}
        self.v = {k: np.zeros_like(v) for k, v in self.p.items()}
        self.t = 0

    def forward(self, x, train=False):
        p = self.p
        W1, W2, W3 = qw(p["W1"]), qw(p["W2"]), qw(p["W3"])
        b1, b2, b3 = qb(p["b1"]), qb(p["b2"]), qb(p["b3"])
        z1 = x @ W1.T + b1
        h1 = np.floor(np.clip(z1, 0, 127 / 128) * 128) / 128
        z2 = h1 @ W2.T + b2
        h2 = np.floor(np.clip(z2, 0, 127 / 128) * 128) / 128
        s = h2 @ W3.T + b3
        if train:
            self.cache = (x, z1, h1, z2, h2, W1, W2, W3)
        return s

    def backward(self, ds):
        x, z1, h1, z2, h2, W1, W2, W3 = self.cache
        g = {}
        g["W3"] = ds.T @ h2
        g["b3"] = ds.sum(0)
        dh2 = ds @ W3
        dz2 = dh2 * ((z2 > 0) & (z2 < 127 / 128))
        g["W2"] = dz2.T @ h1
        g["b2"] = dz2.sum(0)
        dh1 = dz2 @ W2
        dz1 = dh1 * ((z1 > 0) & (z1 < 127 / 128))
        g["W1"] = dz1.T @ x
        g["b1"] = dz1.sum(0)
        # STE: 양자화 범위를 벗어난 가중치는 더 밀지 않는다.
        for k in ("W1", "W2", "W3"):
            w = self.p[k]
            g[k] = g[k] * ((w > -1.0) & (w < 127 / 128))
        return g

    def step(self, g, lr, b1=0.9, b2=0.999, eps=1e-8, wd=0.0):
        self.t += 1
        for k in self.p:
            gk = g[k] + wd * self.p[k]
            self.m[k] = b1 * self.m[k] + (1 - b1) * gk
            self.v[k] = b2 * self.v[k] + (1 - b2) * gk * gk
            mh = self.m[k] / (1 - b1**self.t)
            vh = self.v[k] / (1 - b2**self.t)
            self.p[k] -= (lr * mh / (np.sqrt(vh) + eps)).astype(np.float32)


def evaluate(net, a, rules, inputs="all"):
    x = features(a, inputs).astype(np.float32) / 128
    pt = softmax(a["logit"].astype(np.float64))
    ps = softmax(net.forward(x).astype(np.float64))
    wt, ws = winrate(pt), winrate(ps)
    vt, vs = to_value(wt), to_value(ws)
    d = np.abs(ws - wt) * 100
    c = a["classical"].astype(np.float64)
    lo = a["alpha"].astype(np.float64)
    hi = a["beta"].astype(np.float64)

    def side(v):
        return np.where(v <= lo, -1, np.where(v >= hi, 1, 0))

    def stats(mask):
        n = int(mask.sum())
        if n == 0:
            return {"r": 0.0, "n": 0}
        dm = d[mask]
        return {
            "r": round(n / len(a), 4),
            "n": n,
            "mean_pp": round(float(dm.mean()), 3),
            "p90_pp": round(float(np.percentile(dm, 90)), 3),
            "p99_pp": round(float(np.percentile(dm, 99)), 3),
            "value_mae": round(float(np.abs(vs - vt)[mask].mean()), 1),
            "window_mismatch": round(float((side(vs) != side(vt))[mask].mean()), 4),
        }

    out = {
        "n": len(a),
        "all": {
            "mean_pp": round(float(d.mean()), 3),
            "p50_pp": round(float(np.percentile(d, 50)), 3),
            "p90_pp": round(float(np.percentile(d, 90)), 3),
            "p99_pp": round(float(np.percentile(d, 99)), 3),
            "max_pp": round(float(d.max()), 3),
            "value_mae": round(float(np.abs(vs - vt).mean()), 1),
        },
        "rules": {},
    }
    for rule in rules:
        kind, val = rule.split(":")
        val = float(val)
        if kind == "classical":
            m = margin(c, val)
            inside = (c >= lo - m) & (c <= hi + m)
            routed = ~inside
        else:  # small
            routed = (vs < lo - val) | (vs > hi + val)
        out["rules"][rule] = stats(routed)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", required=True)
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--batch", type=int, default=4096)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--limit", type=int, default=0, help="학습 표본 상한(0 = 전부)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--rec", type=int, default=664, choices=sorted(RECS), help="줄 크기(88 = N1 v1 · 664 = N1b v2)")
    ap.add_argument("--inputs", default="all", choices=["global", "all"], help="소형 헤드 입력(all 은 v2 표본에서만)")
    ap.add_argument(
        "--rules",
        default="classical:300,classical:250,classical:200,classical:150,classical:100,classical:50,"
        "small:0,small:50,small:100,small:150,small:200,small:300",
    )
    args = ap.parse_args()

    t0 = time.time()
    rec = RECS[args.rec]
    tr = load(args.train.split(","), args.limit, rec)
    ho = load(args.holdout.split(","), 0, rec)
    print(f"표본: 학습 {len(tr):,} · 보류 {len(ho):,}  ({time.time() - t0:.1f}s)", flush=True)
    if len(tr) == 0 or len(ho) == 0:
        sys.exit("표본이 없습니다")

    rng = np.random.default_rng(args.seed)
    x_all = features(tr, args.inputs)  # int8 그대로 두고 배치마다 /128(입력 640 · 수백만 줄이면 float 로는 수 GB)
    net = Net(rng, x_all.shape[1])
    pt_all = softmax(tr["logit"].astype(np.float64)).astype(np.float32)
    del tr  # 학습 표본 원본은 더 쓰지 않는다(보고에는 길이만)
    rules = args.rules.split(",")

    steps_per_epoch = max(1, len(x_all) // args.batch)
    total = steps_per_epoch * args.epochs
    history = []
    for ep in range(args.epochs):
        order = rng.permutation(len(x_all))
        loss_sum = 0.0
        for i in range(steps_per_epoch):
            idx = order[i * args.batch : (i + 1) * args.batch]
            x, pt = x_all[idx].astype(np.float32) / 128, pt_all[idx]
            s = net.forward(x, train=True)
            ps = softmax(s.astype(np.float64)).astype(np.float32)
            loss_sum += float(-(pt * np.log(np.clip(ps, 1e-9, 1))).sum(1).mean())
            ds = (ps - pt) / len(idx)
            # 코사인 감쇠
            step = ep * steps_per_epoch + i
            lr = args.lr * 0.5 * (1 + math.cos(math.pi * step / total))
            net.step(net.backward(ds), lr)
        ev = evaluate(net, ho, rules, args.inputs)
        history.append({"epoch": ep + 1, "train_ce": round(loss_sum / steps_per_epoch, 5), "holdout": ev["all"]})
        a = ev["all"]
        print(
            f"epoch {ep + 1}/{args.epochs} · CE {loss_sum / steps_per_epoch:.4f} · 보류 승률 차 "
            f"평균 {a['mean_pp']}%p · p99 {a['p99_pp']}%p · 값 MAE {a['value_mae']}  ({time.time() - t0:.0f}s)",
            flush=True,
        )

    ev = evaluate(net, ho, rules, args.inputs)
    os.makedirs(args.out, exist_ok=True)
    # 엔진에 그대로 싣는 정수 가중치(FCWeight<Out, In> 의 행 = 출력)
    q = {
        "W1": np.clip(np.round(net.p["W1"] * 128), -128, 127).astype(np.int8),
        "b1": np.round(net.p["b1"] * 16384).astype(np.int32),
        "W2": np.clip(np.round(net.p["W2"] * 128), -128, 127).astype(np.int8),
        "b2": np.round(net.p["b2"] * 16384).astype(np.int32),
        "W3": np.clip(np.round(net.p["W3"] * 128), -128, 127).astype(np.int8),
        "b3": np.round(net.p["b3"] * 16384).astype(np.int32),
    }
    np.savez(os.path.join(args.out, "small-head.npz"), **q)
    with open(os.path.join(args.out, "small-head.bin"), "wb") as f:
        for k in ("W1", "b1", "W2", "b2", "W3", "b3"):
            f.write(q[k].tobytes())
    # 대조: 표본의 가르기(학습에 쓴 게 아닌 보류에서)
    report = {
        "samples": {"train": len(x_all), "holdout": len(ho)},
        "inputs": {"kind": args.inputs, "dim": int(x_all.shape[1])},
        "holdout_ply": {
            "p10": int(np.percentile(ho["ply"], 10)),
            "p50": int(np.percentile(ho["ply"], 50)),
            "p90": int(np.percentile(ho["ply"], 90)),
        },
        "args": vars(args),
        "history": history,
        "final": ev,
        "seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(args.out, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    a = ev["all"]
    print(f"\n보류 {ev['n']:,} — 승률 차 평균 {a['mean_pp']}%p · p50 {a['p50_pp']} · p90 {a['p90_pp']} · p99 {a['p99_pp']} · 최대 {a['max_pp']} · 값 MAE {a['value_mae']}")
    print("분기 규칙 — 소형으로 돌릴 몫 r · 그 몫의 승률 차 평균 / p99(%p) · 값 MAE · α-β 판단 불일치")
    for rule, s in ev["rules"].items():
        if s.get("n", 0) == 0:
            print(f"  {rule:16s} r 0")
            continue
        print(
            f"  {rule:16s} r {s['r']:.3f} · {s['mean_pp']:.2f} / {s['p99_pp']:.2f}%p · MAE {s['value_mae']:.0f} · "
            f"불일치 {s['window_mismatch'] * 100:.2f}%"
        )


if __name__ == "__main__":
    main()
