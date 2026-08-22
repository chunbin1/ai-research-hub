#!/usr/bin/env python3
"""
SuperTrend 引擎的**独立参考实现** —— golden test 期望值的审计凭证。

为什么存在:
    supertrend.golden.test.ts 的期望值必须锚定在已提交的 fixture 上,而且要求
    「重建 fixture 时用独立实现交叉验算后再更新期望值」。如果仓库里没有一份
    独立实现,那条要求就能被敷衍过去 —— 拿 supertrend() 自己的输出当「交叉验算」,
    等于自己证明自己。这个脚本就是那份独立实现。

为什么它是独立的:
    它是照着 TradingView Pine Script v6 的语义直接写的,**不是从 TS 代码移植的**,
    而且用的是另一种语言、另一套浮点库。两边逐位吻合才有意义。

用法:
    python3 scripts/verify-supertrend-reference.py
    把输出与 packages/server/src/services/signals/supertrend.golden.test.ts
    里的期望值逐项对照。不一致就**不要改测试** —— 先查引擎和 fixture。
"""
import json
import os
import sys

FIXTURE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', 'packages', 'server', 'src', 'services', 'signals',
    '__fixtures__', 'ALB-daily.json',
)
PERIOD, MULT = 10, 3.0


def supertrend(bars, period=PERIOD, mult=MULT):
    """照 Pine v6 语义直译:ta.tr / ta.rma(SMA 播种) / 棘轮 / 趋势粘性。"""
    n = len(bars)
    if period < 2 or n < period + 1:
        return []

    # ta.tr —— 首根没有前收,退化为 high - low
    tr = [bars[0]['high'] - bars[0]['low']]
    for i in range(1, n):
        pc = bars[i - 1]['close']
        tr.append(max(bars[i]['high'] - bars[i]['low'],
                      abs(bars[i]['high'] - pc),
                      abs(bars[i]['low'] - pc)))

    # ta.rma —— 前 period 根取 SMA 播种,之后 Wilder 平滑
    atr = [None] * n
    atr[period - 1] = sum(tr[:period]) / period
    for i in range(period, n):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period

    out = []
    up = dn = None
    trend = 1
    for i in range(period - 1, n):
        b = bars[i]
        src = (b['high'] + b['low']) / 2          # hl2
        raw_up, raw_dn = src - mult * atr[i], src + mult * atr[i]
        up1 = up if up is not None else raw_up    # nz(up[1], up)
        dn1 = dn if dn is not None else raw_dn
        prev_close = bars[i - 1]['close']
        # 棘轮:趋势未破时线只许朝有利方向走
        up = max(raw_up, up1) if prev_close > up1 else raw_up
        dn = min(raw_dn, dn1) if prev_close < dn1 else raw_dn
        # 粘性:两条线都没被击穿就维持原状
        trend = 1 if b['close'] > dn1 else (-1 if b['close'] < up1 else trend)
        out.append({'date': b['date'], 'trend': trend, 'up': up, 'dn': dn, 'atr': atr[i]})
    return out


def main():
    if not os.path.exists(FIXTURE):
        print(f'找不到 fixture: {FIXTURE}', file=sys.stderr)
        return 1
    with open(FIXTURE, encoding='utf-8') as fh:
        bars = json.load(fh)

    pts = supertrend(bars)
    if not pts:
        print('引擎返回空序列 —— fixture 根数不足或 period 配错', file=sys.stderr)
        return 1
    last = pts[-1]
    flips = [(p['date'], p['trend'])
             for i, p in enumerate(pts) if i > 0 and p['trend'] != pts[i - 1]['trend']]

    print('独立参考实现(Python)跑已提交 fixture 的结果:')
    print(f'  bars.length      = {len(bars)}')
    print(f'  pts.length       = {len(pts)}')
    print(f"  pts[0].date      = '{pts[0]['date']}'")
    print(f"  pts[0].atr       = {pts[0]['atr']!r}")
    print(f"  last.date        = '{last['date']}'")
    print(f"  last.trend       = {last['trend']}")
    print(f"  last.up          = {last['up']!r}")
    print(f"  last.dn          = {last['dn']!r}")
    print(f"  last.atr         = {last['atr']!r}")
    print(f'  flips.length     = {len(flips)}')
    print(f'  flips.slice(-4)  = {[list(f) for f in flips[-4:]]}')
    print()
    print('把以上各值与 supertrend.golden.test.ts 的期望值逐项对照。')
    print('不一致说明引擎或 fixture 变了 —— 先查它们,不要直接改测试。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
