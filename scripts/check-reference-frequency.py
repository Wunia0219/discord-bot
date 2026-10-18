"""Length-independent feasibility check; does not design or install game reels.

All bounds are explicit diagnostic conditions, not silently relaxed objectives.
Use integer arithmetic and fractions for the proofs. A common denominator used
for arithmetic is not a proposed physical reel length.
"""
import itertools
import json
import math
from fractions import Fraction as F
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = json.loads((ROOT / 'docs/reference-243-analysis.json').read_text(encoding='utf-8'))
REFERENCE = SOURCE['reference']
CODES = ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'W']
PAY = SOURCE['candidate']['existingPaytable']
TARGET_RTP = F(24, 25)


def fraction_record(value):
    return {'numerator': str(value.numerator), 'denominator': str(value.denominator), 'value': float(value)}


def profile(row):
    counts, n = row['counts'], row['length']
    high = [F(counts.get('H' + str(i), 0), n) for i in range(1, 5)]
    wild = F(counts.get('W', 0), n)
    # Retain the existing four low symbols and no Scatter feature. This is one
    # declared conversion of five source lows, not a claim about their paytable.
    available = 1 - sum(high) - wild
    normal = [counts['N' + str(i)] for i in range(1, 5)]
    return high + [available * F(k, sum(normal)) for k in normal] + [wild]


PROBABILITIES = [profile(r) for r in REFERENCE]
assert all(sum(r) == 1 for r in PROBABILITIES)
assert PROBABILITIES[0][8] == PROBABILITIES[1][8] == 0


def integer_basis(probabilities):
    denominators = [math.lcm(*(x.denominator for x in r)) for r in probabilities]
    return [[int(p * n) for p in r] for r, n in zip(probabilities, denominators)], denominators


def prefix_oracle(line):
    """Independent highest-award prefix scorer, including all-WILD prefixes."""
    best = 0
    for n in (3, 4, 5):
        ordinary = set(line[:n]) - {8}
        if not ordinary:
            best = max(best, *(p[n - 3] for p in PAY))
        elif len(ordinary) == 1:
            best = max(best, PAY[next(iter(ordinary))][n - 3])
    return best


def oracle_expectation(probabilities):
    rows, denominators = integer_basis(probabilities)
    total = 0
    for line in itertools.product(range(9), repeat=5):
        weight = math.prod(rows[i][s] for i, s in enumerate(line))
        if weight:
            total += weight * prefix_oracle(line)
    return F(total, math.prod(denominators))


def first_four_coefficients(rows, denominators):
    # The reference has no WILD on R1/R2, so every winning line has exactly one
    # possible ordinary symbol. These coefficient expressions have no overlap.
    assert rows[0][8] == rows[1][8] == 0
    base, extra = 0, []
    for s in range(8):
        first_three = rows[0][s] * rows[1][s] * (rows[2][s] + rows[2][8])
        fourth = rows[3][s] + rows[3][8]
        base += first_three * ((denominators[3] - fourth) * PAY[s][0] + fourth * PAY[s][1])
        extra.append(first_three * fourth * (PAY[s][2] - PAY[s][1]))
    return base, extra


def weighted_numerator(rows, denominators):
    base, extra = first_four_coefficients(rows, denominators)
    return base * denominators[4] + sum(extra[s] * (rows[4][s] + rows[4][8]) for s in range(8))


def relaxed_global_maximum(low_cap, verify_all_five=False):
    """Global maximum with exact source high/W shares and arbitrary four lows.

    All four low probabilities may move freely between 0 and low_cap. This even
    permits a low symbol to disappear, making the bound more generous than a
    balanced reference design. No single-symbol mapping of N5 is assumed here.
    """
    vertices, denominators, limits = [], [], []
    for r in REFERENCE:
        n, counts = r['length'], r['counts']
        basis = math.lcm(n, low_cap.denominator)
        limit = low_cap.numerator * (basis // low_cap.denominator)
        high = [counts.get('H' + str(i), 0) * (basis // n) for i in range(1, 5)]
        wild = counts.get('W', 0) * (basis // n)
        remaining = basis - sum(high) - wild
        lows = set()
        # At a vertex of the bounded four-symbol simplex, three components are
        # at a bound and the fourth is fixed by their sum.
        for free in range(4):
            for fixed in itertools.product((0, limit), repeat=3):
                row = list(fixed)
                row.insert(free, remaining - sum(fixed))
                if 0 <= row[free] <= limit:
                    lows.add(tuple(row))
        assert lows, 'Empty diagnostic frequency region'
        vertices.append([high + list(v) + [wild] for v in sorted(lows)])
        denominators.append(basis)
        limits.append(limit)
    best, witness = -1, None
    for first in itertools.product(*vertices[:4]):
        base, extra = first_four_coefficients(first, denominators)
        last = vertices[4][0].copy()
        remaining = sum(last[4:8])
        last[4:8] = [0] * 4
        # Conditional expectation is linear in R5. Allocate its low-symbol mass
        # to the largest exact coefficient first, respecting the common cap.
        for s in sorted(range(4, 8), key=lambda s: extra[s], reverse=True):
            last[s] = min(remaining, limits[4])
            remaining -= last[s]
        assert remaining == 0
        value = base * denominators[4] + sum(extra[s] * (last[s] + last[8]) for s in range(8))
        if value > best:
            best, witness = value, [*first, last]
    if verify_all_five:
        # Independently check the analytic R5 maximizer against all vertices of
        # all five reels, with no greedy optimization or random sampling.
        exhaustive = max(weighted_numerator(rows, denominators) for rows in itertools.product(*vertices))
        assert best == exhaustive
    result = F(best, math.prod(denominators))
    witness_p = [[F(x, n) for x in r] for r, n in zip(witness, denominators)]
    if verify_all_five:
        assert result == oracle_expectation(witness_p)
    return {
        'lowSymbolProbabilityCap': float(low_cap),
        'exactGlobalMaximumRtp': fraction_record(result),
        'verticesPerReel': [len(v) for v in vertices],
        'firstFourVertexCombinations': math.prod(len(v) for v in vertices[:4]),
        'allFiveVertexCrosscheck': verify_all_five,
        'maximizingLowSymbolProbabilities': [[float(x) for x in r[4:8]] for r in witness_p],
    }


def neighborhood_upper_bound(tolerance):
    # For any line, its maximum candidate award is <= the sum of all candidate
    # awards. Replace every matching probability by its permitted maximum.
    # Incompatible maxima are deliberately allowed, so this is a conservative
    # upper bound, never an assumed feasible distribution.
    caps = [[min(F(1), p + tolerance) for p in r] for r in PROBABILITIES]
    bound = F(0)
    for s in range(9):
        q = [r[s] + (r[8] if s != 8 else 0) for r in caps]
        bound += q[0] * q[1] * q[2] * (PAY[s][0] + q[3] * (PAY[s][1] - PAY[s][0]) + q[3] * q[4] * (PAY[s][2] - PAY[s][1]))
    return {'perSymbolTolerancePercentagePoints': float(tolerance * 100), 'rigorousRtpUpperBound': fraction_record(bound)}


baseline_rows, baseline_denominators = integer_basis(PROBABILITIES)
baseline = F(weighted_numerator(baseline_rows, baseline_denominators), math.prod(baseline_denominators))
assert baseline == oracle_expectation(PROBABILITIES)
bounds = [relaxed_global_maximum(cap, cap == F(13, 50)) for cap in (F(1, 4), F(13, 50), F(3, 10), F(17, 50))]
assert F(bounds[1]['exactGlobalMaximumRtp']['numerator']) / F(bounds[1]['exactGlobalMaximumRtp']['denominator']) < TARGET_RTP
active = json.loads((ROOT / 'output/reel-design-v5/model.json').read_text(encoding='utf-8'))
violations = []
for i, (codes, target) in enumerate(zip(active['reels'], PROBABILITIES)):
    for s, code in enumerate(CODES):
        actual = F(codes.count(code), len(codes))
        if abs(actual - target[s]) > F(1, 50):
            violations.append({'reel': i + 1, 'symbol': code, 'referenceMappedProbability': float(target[s]), 'v5Probability': float(actual), 'differencePercentagePoints': float((actual - target[s]) * 100)})
output = {
    'status': 'feasibility diagnosis only; v5 does not meet the clarified frequency requirement; no replacement model applied',
    'referenceSourceSha256': SOURCE['sourceSha256'],
    'rules': 'Independent fixed strips; 5 reels x 3 rows; existing 20 paylines; line bet = total bet / 20; existing fixed paytable; no Scatter/bonus awards.',
    'codes': CODES,
    'paytable': PAY,
    'reelLengthPolicy': 'No prescribed length. All calculations use probabilities and exact rational arithmetic. Fractions are not physical reel-length proposals.',
    'mappedReferenceProbabilities': [[float(x) for x in r] for r in PROBABILITIES],
    'mappingAssumption': 'Preserve exact source H1..H4 and W probabilities. Redistribute N5 and nonpaying SC space proportionally over N1..N4 mapped to L1..L4. The global cap bounds below allow all four low probabilities to vary freely and do not rely on this mapping.',
    'referenceFrequencyBaselineRtp': fraction_record(baseline),
    'uniformPayoutScaleFor96AtThatBaseline': fraction_record(TARGET_RTP / baseline),
    'baselineOracleChecked': 'All 9^5 symbol outcomes evaluated with an independent prefix scorer and integer probability weights.',
    'globalMaximumConditions': 'Keep each reel high-symbol/WILD probabilities equal to the supplied reference. Permit arbitrary four low probabilities between zero and the stated cap, summing to the remaining mass. Even disappearance of low symbols is permitted for this upper bound.',
    'globalMaximumProof': 'Expectation is multi-affine in independent reel probabilities. Maxima on a product of bounded simplexes occur at vertices. All vertices of the first four reels are enumerated exactly; R5 is an exact linear optimization. At 26%, all five-reel vertex combinations and an independent line oracle are additionally checked.',
    'globalMaximumResults': bounds,
    'mappedReferenceNeighborhoodBounds': [neighborhood_upper_bound(F(n, 100)) for n in (1, 2, 3)],
    'v5DeviationsBeyondTwoPercentagePoints': violations,
    'v5SearchDefect': 'The previous generator hard-coded L1 to 12..17 out of a 40-count basis, or 30%..42.5%, and optimized soft frequency deviations. It did not enforce the requested per-symbol distribution as a hard acceptance condition.',
}
(ROOT / 'docs/reference-frequency-feasibility.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'baselineRtp': float(baseline), 'globalMaximumResults': bounds, 'v5FrequencyViolations': len(violations), 'runtimeFilesChanged': False}, ensure_ascii=False, indent=2))
