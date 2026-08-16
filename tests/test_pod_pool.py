"""Regression tests for the pod-selection pool (scripts/extract_quotes.py).

Locks in the three 2026-08-15 pool-rotation fixes: (a) the pool is a rolling
DNS-freshness window, never append-only; (b) selection only ever offers live,
unblocked pods and falls back to plain DNS when none are known; (c) a pod
that answered 4xx is dead to the process. See
docs/POD_SELECTION_CASE_STUDY.md for the incident these guard against.

Run: python3 -m unittest tests.test_pod_pool
"""

import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import extract_quotes as eq  # noqa: E402


def _no_dns(host, *a, **kw):
    raise OSError("no network in tests")


class PodPoolTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._out_dir = eq.OUT_DIR
        self._gai = eq._real_getaddrinfo
        eq.OUT_DIR = self._tmp.name          # shared pool file goes to tmp
        eq._real_getaddrinfo = _no_dns       # tests never touch real DNS
        eq._POD_POOL.clear()
        eq._POD_BLOCKED.clear()
        eq._pod_choice["ip"] = None
        eq._pod_state["last_refresh"] = 0.0

    def tearDown(self):
        eq.OUT_DIR = self._out_dir
        eq._real_getaddrinfo = self._gai
        eq._POD_POOL.clear()
        eq._POD_BLOCKED.clear()
        eq._pod_choice["ip"] = None
        self._tmp.cleanup()

    def test_stale_pods_age_out(self):
        now = time.time()
        eq._POD_POOL.update({
            "10.0.0.1": now,
            "10.0.0.2": now - eq.POD_TTL_S - 1,   # rotated away > TTL ago
        })
        self.assertEqual(eq._live_pods(), ["10.0.0.1"])
        # and the shared file written by a refresh must not resurrect it
        eq._refresh_pod_pool(force=True)
        self.assertNotIn("10.0.0.2", eq._POD_POOL)

    def test_blocked_pod_never_offered(self):
        now = time.time()
        eq._POD_POOL.update({"10.0.0.1": now, "10.0.0.2": now})
        eq.block_pod("10.0.0.2")
        self.assertEqual(eq._live_pods(), ["10.0.0.1"])
        self.assertNotIn("10.0.0.2", eq._POD_POOL)

    def test_win_stay_keeps_fast_pod(self):
        eq._POD_POOL.update({"10.0.0.1": time.time(), "10.0.0.2": time.time()})
        eq._pod_choice["ip"] = "10.0.0.1"
        self.assertEqual(eq.choose_pod(last_segment_mbs=eq.POD_KEEP_MBS + 1),
                         "10.0.0.1")

    def test_lose_shift_leaves_slow_pod(self):
        eq._POD_POOL.update({"10.0.0.1": time.time(), "10.0.0.2": time.time()})
        eq._pod_choice["ip"] = "10.0.0.1"
        self.assertEqual(eq.choose_pod(last_segment_mbs=eq.POD_KEEP_MBS - 1),
                         "10.0.0.2")

    def test_stale_pinned_choice_is_abandoned(self):
        """The incident shape: the pinned pod rotates away; win-stay must NOT
        keep it even if its last segment was fast, because it is no longer
        live."""
        now = time.time()
        eq._POD_POOL.update({
            "10.0.0.1": now - eq.POD_TTL_S - 1,   # pinned but rotated away
            "10.0.0.2": now,
        })
        eq._pod_choice["ip"] = "10.0.0.1"
        self.assertEqual(eq.choose_pod(last_segment_mbs=99.0), "10.0.0.2")

    def test_empty_pool_falls_back_to_plain_dns(self):
        self.assertIsNone(eq.choose_pod(last_segment_mbs=None))
        self.assertIsNone(eq._pod_choice["ip"])   # None = unpatched resolution


if __name__ == "__main__":
    unittest.main()
