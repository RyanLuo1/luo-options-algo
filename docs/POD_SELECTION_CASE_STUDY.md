# Case study: the pod-selection problem — DNS-TTL clumping, a bandit selector, and the pool-rotation incident

*2026-08. First-person account of a throughput investigation during the Phase B2
year-scale extraction (RANKER_SPEC). Companion piece to the stale-quote case
study. All numbers are from the actual logs and code; where a figure could not
be re-verified it is marked approximate.*

## 1. The one-minute version

I was bulk-downloading ~25–35 TB of OPRA options quote history (~250 day-files,
105–220 GB each) from a market-data vendor's S3-compatible endpoint. Burst
throughput was demonstrably high — a 16-stream ladder probe measured **85.8
MB/s** — but sustained fleet throughput sat stuck around **16–17 MB/s**,
roughly a fifth of demonstrated capacity, flat around the clock.

I first misdiagnosed this as an **account-level throttle**, and the evidence
genuinely fit: while my 12-worker fleet pulled ~17 MB/s, an 8-stream probe from
a *different machine with a different IP* — which had hit 50.1 MB/s in
isolation the day before — managed only 4.8 MB/s, and the two summed
suspiciously close to the same ~22 MB/s. Cross-IP degradation looks exactly
like a per-account cap.

The vendor's support said otherwise: *no account limit — files are served from
shared pods, throughput is congestion-based, reconnect periodically to re-roll
your pod assignment.* Three tests later the real mechanism emerged:
`files.massive.com` returns **one A record per query with a ~34-second TTL**,
rotating through a pod pool — so every connection opened within a TTL window
lands on the **same pod**, and our "reconnects" were faithfully re-resolving
into the same congested pod as everyone's neighbor. Measured at the same
instant, pods varied **35×**: 0.8 MB/s on the worst, 27.9 MB/s on the best.

The fix was a client-side pod selector: accumulate every IP DNS ever returns
into a shared pool, pin connections to chosen pods (TLS still validates via
SNI), and select with **win-stay/lose-shift** — keep a pod while its last
segment beat 6 MB/s, otherwise re-roll randomly. With it, the high numbers
became reproducible at will (**49.5 MB/s at 8 streams, 70.5 at 16**, measured
while the old slow fleet still ran underneath), and the production fleet then
averaged **~25 MB/s sustained over 42 hours**, completing 35 day-files
(~3.85 TB) before an incident of my own making stopped it — see §5.

## 2. The investigation, in sequence

**The false theory and why it fit.** Sustained rates from every vantage point
landed in a narrow band: single streams decayed from 16–18 MB/s at open to
~2.3 over hours; two machines running concurrently summed to ~10.6 MB/s;
the fleet held ~17. A 24-hour reconstruction from worker logs showed
per-stream rates of 1.3–2.5 MB/s essentially **flat around the clock** — no
diurnal structure, which read as "policy, not load." The capstone was the
cross-IP test above. Everything pointed at an adaptive account-level ceiling
with burst tolerance. It was wrong.

**The vendor's reply** — no limit, shared pods, congestion-based, reconnect to
re-roll — reframed the question from *how much are we allowed* to *where are
our connections landing*.

**Test 1 — DNS behavior.** `dig` returned a single A record per query
(observed pool across queries and resolvers: `198.44.194.{31,32,33,36,42,44,
52,57,59,66,67}` — eleven distinct pod IPs at peak), TTL ~34 s. Successive
queries inside one TTL window return the same IP; different resolvers and
different windows return different pods. Checking the live fleet's established
connections: **3 of 4 data connections sat on one pod** — the workers had
launched within one TTL window and clumped.

**Test 2 — the 24 h curve** (above): flat. Congestion is per-pod, not
per-hour. This killed the time-of-day hypothesis.

**Test 3 — the discriminating measurement.** Pin connections to each known pod
IP directly (patched `getaddrinfo`, hostname preserved for SNI/TLS) and
measure simultaneously: `.44` served 0.8 MB/s, `.59` 1.4, `.57` 5.1, `.67`
25.9, `.42` **27.9**. Same account, same second, 35× spread. The "account
ceiling" was the expected value of landing on random congested pods; the
cross-IP test that fooled me was just two machines both stuck on slow pods —
correlated bad luck, not a shared quota.

## 3. The solution: a multi-armed bandit over mirror servers

The selector, in `scripts/extract_quotes.py`:

- **Discovery**: the stream read loop re-resolves DNS at most every 30 s
  (`POD_REFRESH_S`) — decoupled from connection recycling, because a slow pod
  means recycles come ~10 minutes apart, far too slow to learn the pool.
- **Cross-worker sharing**: discoveries merge through a per-box
  `data/extracts/pod_pool.json` — eight workers learn the pool eight times
  faster than one (without this, each worker's pool was literally `pool 1` at
  launch and everyone clumped again).
- **Selection**: win-stay/lose-shift. Keep the current pod while the last
  ~1 GB segment averaged ≥ 6 MB/s (`POD_KEEP_MBS`); otherwise re-roll to a
  random other pod. Stream errors force a re-roll. Connections recycle every
  1 GB (`--reconnect-every-gb 1`), so a bad pick costs at most one segment.
- **Mechanics**: `socket.getaddrinfo` is patched for this one hostname to
  return the chosen pod IP; TLS still validates the real hostname via SNI.

This is honestly framed: it is a **multi-armed bandit over mirror servers** —
explore (random re-roll), exploit (win-stay), with congestion itself as the
reward signal. It is also exactly what multi-mirror download managers and
BitTorrent-style clients have always done; I reinvented it from first
principles because the problem arrived dressed as a rate-limit mystery rather
than a mirror-selection problem.

Validation: the ladder that had produced 85.8 MB/s only in short fresh-
connection bursts became reproducible policy — 8 re-rolling streams sustained
49.5 MB/s and 16 sustained 70.5 while the pre-fix fleet still occupied
bandwidth underneath, and the rebuilt fleet averaged ~25 MB/s over 42
continuous hours of production streaming (35 day-files).

## 4. Fix one bottleneck, meet the next (and check your theory)

With pods no longer the constraint on a 2-vCPU box, per-worker rates stopped
tracking pod quality: each worker interleaves socket reads with gzip + parse
on the same thread, so the socket starves during CPU work. I hypothesized the
2-vCPU machine was duty-cycle-bound and migrated to 8 vCPU. The first
measurement on the bigger box was **worse** (9 MB/s, CPU nearly idle) — which
is what exposed the real remaining bug: per-worker pod pools of size one (the
sharing fix in §3 didn't exist yet). The honest sequence is: I migrated on a
partially wrong theory, and the falsifying measurement led to the actual fix.
The bigger box still mattered — once the selector worked, 8 workers had CPU
headroom to ride fast pods that the 2-vCPU box would have squandered — but the
lesson stands twice over: fixing one bottleneck surfaces the next, and a
migration that "should" help but doesn't is a measurement, not a
disappointment.

## 5. The incident: the pool-rotation burn (own goal, fully owned)

Two days into production dripping, the fleet had banked 35 validated
day-files. At **15:22 UTC** the last one completed; by **15:54 UTC** — about
thirty minutes — the workers had claimed, failed, and marked **~210 remaining
dates** as failed with `AccessDenied`/`403`, then exited. Three flaws of mine
composed:

1. **The pool was append-only.** IPs entered on discovery and never left. When
   the vendor rotated their pod fleet (all backend IPs replaced at once —
   their prerogative, presumably a deploy), every entry went stale
   simultaneously, and fresh DNS additions were a minority among corpses.
2. **The pinned choice outlived its target.** `_pod_choice` persisted across
   dates within a worker process. After the rotation it pointed at a pod that
   no longer existed as a valid backend.
3. **The first calls of each date were unprotected.** Each new date begins
   with a day_aggs GET and a quotes HEAD — issued *before* the streaming
   machinery whose error path knows how to re-roll. Those calls rode the stale
   pinned pod, got 403, and the worker marked the date failed and moved on.
   Every date died in seconds on its first request.

Zero data was lost, by design: `failed` is retry-eligible in the claims
manifest, the 35 banked files had all passed validation at completion, and a
relaunched fleet reclaimed the burned range immediately. The blast radius of
three composed bugs was thirty minutes of wall clock and one diagnosis
session.

The fixes, each small: **(a)** the pool is now `{ip: last_seen_by_DNS}` with a
2-hour rolling window — a fleet-wide rotation purges it naturally; **(b)**
every date starts with the pin reset to plain DNS, which always resolves to a
live pod, and pinning resumes only under the stream's protected error path;
**(c)** any pod answering 4xx is blocklisted for the process on the spot.
`tests/test_pod_pool.py` locks all three in, including the exact incident
shape (a fast, pinned, rotated-away pod must be abandoned by win-stay).

The morals, stated plainly: **a cached routing decision must never outlive the
infrastructure it points at** — and, more specifically, **when you opt out of
DNS's assignment you also opt out of DNS's freshness mechanism, and you must
rebuild that freshness yourself.** TTLs are not an inconvenience to bypass;
they are the contract that lets the server side move things.

## 6. Likely follow-ups

**Why didn't the vendor's advice work as given?** "Reconnect to re-roll"
assumes reconnection implies re-assignment. With a single rotating A record
and a 34 s TTL, every reconnect inside a TTL window re-resolves to the *same*
pod — and a fleet launching together clumps entirely. Reconnection only
re-rolls if you either wait out the TTL or bypass the resolver, and a fleet
needs the bypass.

**Why would the vendor design it this way — why not return all IPs, or run a
real load balancer?** DNS rotation is the zero-cost load balancer: for their
aggregate traffic — many independent clients, short sessions — one rotating
record spreads load statistically just fine, with no LB tier in the data path
to pay for at 100+ GB per file served. The design only fails for the
unusual client: one account holding *many long-lived streams* opened at the
same moment. We were the pathological case, not them.

**What would you do differently?** Age the pool from day one — treat every
cached routing decision as a lease with an expiry, not a fact. And when a
measurement contradicts the current theory (an 8-vCPU box going *slower*),
treat it as the most valuable data point of the week, because it was.

**How did you validate the fix?** Twice over: the ladder numbers became
reproducible on demand (49.5/70.5 MB/s at 8/16 streams versus 8.0/50.1 on the
naive path), and the production fleet held a ~25 MB/s average across 42
continuous hours — sustained, not burst, with 1,891 logged pod re-rolls and 56
clean mid-stream resumes along the way.
