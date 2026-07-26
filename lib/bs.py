"""Black-Scholes implied-vol solver and delta — RANKER_SPEC.md Phase A.

The backtester (Phase B) cannot use Massive's Greeks: they are only served on
the live snapshot, never historically. This module recomputes what the scan
needs — delta per leg — from historical quote midpoints.

V1 approximations (documented per spec open question #2):

- **Constant risk-free rate** ``RISK_FREE_RATE = 0.045``. No term structure.
  Delta sensitivity to r at our DTEs (< 3 months) is small relative to the
  spec's ±0.02 acceptance bar.
- **European exercise, no dividend adjustment.** Listed equity options are
  American on dividend-paying underlyings; solving European BS from an
  American price slightly overstates IV (most visibly for ITM puts and calls
  near an ex-dividend date). Accepted for v1; the Phase A validation gate
  measures the aggregate effect against Massive's live Greeks.
- IV is solved from the **quote midpoint** — the same convention the Phase B
  replay feeds it.

Honesty rule: ``implied_vol`` returns ``None`` whenever the solve is
ill-posed (price at/below intrinsic, price above the no-arbitrage upper
bound, expired, non-positive inputs). It never fabricates a number.

Stdlib only — no numpy/scipy required.
"""

import math

# Approximation: constant risk-free rate (v1; see module docstring).
RISK_FREE_RATE = 0.045

# IV search bracket. Below the floor the option is numerically at intrinsic;
# above the cap the quote is garbage for our purposes (500% vol).
_IV_LO = 1e-4
_IV_HI = 5.0

# A mid this close to intrinsic (in absolute $) leaves IV undetermined —
# tiny quote noise swings the solve wildly. Return None instead.
_MIN_TIME_VALUE = 1e-4


def _norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x):
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _d1(spot, strike, dte_years, r, iv):
    return ((math.log(spot / strike) + (r + 0.5 * iv * iv) * dte_years)
            / (iv * math.sqrt(dte_years)))


def bs_price(option_type, spot, strike, dte_years, r, iv):
    """European Black-Scholes price. option_type: 'call' or 'put'."""
    d1 = _d1(spot, strike, dte_years, r, iv)
    d2 = d1 - iv * math.sqrt(dte_years)
    disc = math.exp(-r * dte_years)
    if option_type == "call":
        return spot * _norm_cdf(d1) - strike * disc * _norm_cdf(d2)
    return strike * disc * _norm_cdf(-d2) - spot * _norm_cdf(-d1)


def _vega(spot, strike, dte_years, r, iv):
    return spot * _norm_pdf(_d1(spot, strike, dte_years, r, iv)) * math.sqrt(dte_years)


def delta(option_type, spot, strike, dte_years, r, iv):
    """Signed Black-Scholes delta: calls in (0, 1), puts in (-1, 0).

    The screener compares |delta| against its leg windows; callers that need
    the unsigned value take abs().
    Returns None on non-positive spot/strike/dte/iv.
    """
    if spot <= 0 or strike <= 0 or dte_years <= 0 or iv is None or iv <= 0:
        return None
    d1 = _d1(spot, strike, dte_years, r, iv)
    if option_type == "call":
        return _norm_cdf(d1)
    return _norm_cdf(d1) - 1.0


def implied_vol(option_type, price, spot, strike, dte_years, r=None):
    """Solve Black-Scholes IV from an option price (feed it the quote mid).

    Returns the IV as a float, or None when the solve is ill-posed:
      - non-positive price/spot/strike/dte
      - price at or below intrinsic (deep-ITM quotes carry ~no vol
        information; below-intrinsic means a bad quote)
      - price above the no-arbitrage upper bound (call > spot,
        put > discounted strike)
      - price outside what any vol in [1e-4, 5.0] can produce

    Newton from a mid-bracket start, with guaranteed-convergence bisection
    fallback (price is strictly increasing in vol).
    """
    if r is None:
        r = RISK_FREE_RATE
    if option_type not in ("call", "put"):
        raise ValueError(f"option_type must be 'call' or 'put', got {option_type!r}")
    if price is None or price <= 0 or spot <= 0 or strike <= 0 or dte_years <= 0:
        return None

    disc = math.exp(-r * dte_years)
    if option_type == "call":
        intrinsic = max(0.0, spot - strike * disc)
        upper = spot
    else:
        intrinsic = max(0.0, strike * disc - spot)
        upper = strike * disc
    if price <= intrinsic + _MIN_TIME_VALUE or price >= upper:
        return None

    lo, hi = _IV_LO, _IV_HI
    f_lo = bs_price(option_type, spot, strike, dte_years, r, lo) - price
    f_hi = bs_price(option_type, spot, strike, dte_years, r, hi) - price
    if f_lo > 0 or f_hi < 0:
        return None  # no vol in the bracket reproduces this price

    # Newton (fast path), falling back to bisection when it strays or stalls.
    iv = 0.3
    for _ in range(20):
        diff = bs_price(option_type, spot, strike, dte_years, r, iv) - price
        if abs(diff) < 1e-10:
            return iv
        v = _vega(spot, strike, dte_years, r, iv)
        if v < 1e-12:
            break
        step = diff / v
        nxt = iv - step
        if not (lo < nxt < hi):
            break
        if abs(step) < 1e-12:
            return iv
        iv = nxt
    else:
        diff = bs_price(option_type, spot, strike, dte_years, r, iv) - price
        if abs(diff) < 1e-8:
            return iv

    # Bisection: monotone in vol, so this always converges within the bracket.
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        if bs_price(option_type, spot, strike, dte_years, r, mid) - price < 0:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-10:
            break
    return 0.5 * (lo + hi)
