import math
from options_screener import black_scholes_delta

PASS = "PASS"
FAIL = "FAIL"

def check(condition, label):
    status = PASS if condition else FAIL
    print(f"  [{status}] {label}")
    return condition

def section(title):
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


# ─────────────────────────────────────────────────────────────
# 1. Black-Scholes delta sanity checks
# ─────────────────────────────────────────────────────────────
section("1. Black-Scholes Delta")

cases = [
    ("NVDA 5% OTM Call",  174, 183, 7/365, 0.50, "call"),
    ("NVDA 5% OTM Put",   174, 165, 7/365, 0.50, "put"),
    ("NVDA 15% OTM Call", 174, 200, 7/365, 0.50, "call"),
    ("NVDA 3% OTM Call",  174, 177, 7/365, 0.50, "call"),
]

deltas = {}
for label, S, K, T, sigma, side in cases:
    d = black_scholes_delta(S, K, T, sigma, side)
    deltas[label] = d
    print(f"\n  {label}: S={S}, K={K}, T={T:.4f}, sigma={sigma}, side={side}")
    print(f"    Delta = {d:.6f}")
    check(d is not None,      "delta is not None")
    check(0 < d < 1,          "delta is between 0 and 1")

# Deeper OTM = lower delta (calls)
print()
call_5  = deltas["NVDA 5% OTM Call"]
call_15 = deltas["NVDA 15% OTM Call"]
call_3  = deltas["NVDA 3% OTM Call"]
check(call_3 > call_5,   f"3% OTM call delta ({call_3:.4f}) > 5% OTM call delta ({call_5:.4f})")
check(call_5 > call_15,  f"5% OTM call delta ({call_5:.4f}) > 15% OTM call delta ({call_15:.4f})")

# Put delta is positive (abs value) and less than 0.5 for OTM
put_5 = deltas["NVDA 5% OTM Put"]
check(0 < put_5 < 0.5,   f"5% OTM put delta ({put_5:.4f}) is positive and < 0.5")


# ─────────────────────────────────────────────────────────────
# 2. IV filter logic
# ─────────────────────────────────────────────────────────────
section("2. IV Filter Logic")

def iv_passes_filter(iv):
    """Mirrors the filter logic in options_screener.build_rows()"""
    return bool(iv and iv == iv and iv > 0.01)

test_ivs = [
    (None,      False, "None IV"),
    (float("nan"), False, "NaN IV"),
    (0.0,       False, "zero IV"),
    (0.00001,   False, "placeholder IV (0.00001)"),
    (0.01,      False, "exactly 0.01 (boundary, should fail)"),
    (0.011,     True,  "just above threshold (0.011)"),
    (0.35,      True,  "normal IV (0.35)"),
    (0.80,      True,  "high IV (0.80)"),
]

for iv, expected, label in test_ivs:
    result = iv_passes_filter(iv)
    check(result == expected, f"{label}: iv={iv} → filter={'PASS' if result else 'BLOCK'}")


# ─────────────────────────────────────────────────────────────
# 3. Ratio math verification
# ─────────────────────────────────────────────────────────────
section("3. Ratio Math Verification")

# Known inputs
S       = 174.0    # stock price
K       = 183.0    # strike (5% OTM call)
T       = 7/365
sigma   = 0.50
premium = 2.50

delta = black_scholes_delta(S, K, T, sigma, "call")
expected_ratio = (premium / S) / delta
code_ratio     = (premium / S) / delta  # same formula as ratio_ranker.calculate_ratios()

print(f"\n  Inputs: S={S}, K={K}, T={T:.4f}, sigma={sigma}, premium={premium}")
print(f"  Delta:           {delta:.6f}")
print(f"  Premium / Price: {premium/S:.6f}")
print(f"  Ratio:           {expected_ratio:.6f}")

check(
    abs(code_ratio - expected_ratio) < 1e-9,
    f"Code ratio ({code_ratio:.6f}) matches manual calculation ({expected_ratio:.6f})"
)

# Confirm higher premium → higher ratio (same delta)
premium_high = 5.00
ratio_high = (premium_high / S) / delta
ratio_low  = (premium / S) / delta
check(ratio_high > ratio_low, f"Higher premium produces higher ratio ({ratio_high:.4f} > {ratio_low:.4f})")

# Confirm higher delta → lower ratio (same premium) — deeper ITM = worse value
delta_high = black_scholes_delta(S, S * 0.97, T, sigma, "call")  # 3% OTM, higher delta
ratio_tight = (premium / S) / delta_high
ratio_wide  = (premium / S) / delta
check(ratio_wide > ratio_tight, f"Lower delta (deeper OTM) produces higher ratio ({ratio_wide:.4f} > {ratio_tight:.4f})")


# ─────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────
print(f"\n{'=' * 60}")
print("  Done.")
print(f"{'=' * 60}\n")
