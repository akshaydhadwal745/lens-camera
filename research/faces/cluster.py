"""People grouping simulation (docs/design/people.md, build step 3).

Same algorithm as the phone's FaceGroups.kt, run on LFW faces with known
identities (embeddings from spike.py SAVE_EMB=..., phone setup int8 + 4 points):
  - a new face joins the group with the best AVERAGE similarity to its members
    if >= MERGE (average linkage = dot with the group's UNnormalised mean: one
    vector per group; a normalised mean would inflate similarity),
  - otherwise it starts a new group (between MATCH and MERGE: "ask the user"),
  - then groups whose average linkage >= MERGE are merged (consolidation pass).

Reports what users would feel:
  wrong faces   = faces in a group whose majority is someone else (the bad error),
  split people  = people spread over more than one group (only annoying: "merge?").
Run: research/.venv/bin/python research/faces/cluster.py research/faces/data/emb-int8-4pt.npz
"""
import sys
from collections import Counter, defaultdict

import numpy as np

import os

MERGE = float(os.environ.get('MERGE', 0.45))
MATCH = 0.363
# Joining a group of ONE face (a noisy reference) needs this much; MARGIN: the best group must beat the runner-up by this.
SINGLE = float(os.environ.get('SINGLE', 0.55))  # chosen 2026-10-13 (see docs/design/people.md)
MARGIN = float(os.environ.get('MARGIN', 0))


def group(E, order):
    """Average linkage via each group's UNnormalised mean: mean(e . m_i) = e . mean(m_i), exactly."""
    sums = np.zeros((0, E.shape[1]))
    counts, members, asks = [], [], 0
    for i in order:
        if counts:
            scores = (sums / np.array(counts)[:, None]) @ E[i]
            g = int(scores.argmax()); score = float(scores[g])
            second = float(np.partition(scores, -2)[-2]) if len(scores) > 1 else -1.0
        else:
            score, second = -1.0, -1.0
        need = SINGLE if counts and counts[g] == 1 else MERGE
        if score >= need and score - second >= MARGIN:
            sums[g] += E[i]; counts[g] += 1; members[g].append(i)
        else:
            if score >= MATCH:
                asks += 1
            sums = np.vstack([sums, E[i]]); counts.append(1); members.append([i])
    # Consolidation: merge groups whose average linkage (mean . mean) >= MERGE, best pair first.
    while True:
        c = np.array(counts)
        means = sums / c[:, None]
        sim = means @ means.T
        np.fill_diagonal(sim, -1)
        need = np.where((c[:, None] == 1) | (c[None, :] == 1), SINGLE, MERGE)
        sim = np.where(sim >= need, sim, -1)
        a, b = np.unravel_index(sim.argmax(), sim.shape)
        if sim[a, b] < 0:
            break
        sums[a] += sums[b]; counts[a] += counts[b]; members[a] += members[b]
        sums = np.delete(sums, b, 0); del counts[b]; del members[b]
    return members, asks


def report(groups, who, asks, label):
    wrong = 0
    for g in groups:
        c = Counter(who[i] for i in g)
        wrong += len(g) - c.most_common(1)[0][1]
    per_person = defaultdict(set)
    for gi, g in enumerate(groups):
        for i in g:
            per_person[who[i]].add(gi)
    multi = [p for p, n in Counter(who).items() if n >= 2]
    split = sum(1 for p in multi if len(per_person[p]) > 1)
    shown = [g for g in groups if len(g) >= 3]  # the app shows groups with >= 3 photos
    wrong_shown = sum(len(g) - Counter(who[i] for i in g).most_common(1)[0][1] for g in shown)
    n = sum(len(g) for g in groups)
    print(f'{label}: {n} faces, {len(groups)} groups ({len(shown)} shown)  '
          f'wrong faces {wrong} ({wrong / n * 100:.2f} %), in shown groups {wrong_shown}  '
          f'split people {split}/{len(multi)} ({split / max(len(multi), 1) * 100:.1f} %)  asks {asks}')


def main():
    d = np.load(sys.argv[1])
    E, who = d['emb'], d['who']
    rng = np.random.default_rng(1)
    for run in range(3):  # order matters a little: try three shooting orders
        order = rng.permutation(len(E))
        groups, asks = group(E, order)
        report(groups, who, asks, f'all LFW, order {run + 1}')
    if 'nfaces' not in d:
        return
    # LFW labels are unreliable on photos with several people (the labelled person
    # may not be the face we took): keep one-face photos only.
    one = np.where(d['nfaces'] == 1)[0]
    E1, who1 = E[one], who[one]
    for run in range(3):
        groups, asks = group(E1, rng.permutation(len(E1)))
        report(groups, who1, asks, f'one-face photos, order {run + 1}')
    # A phone-like library: the 40 people with the most photos (family, friends)
    # plus 300 strangers seen once (bystanders), shuffled.
    counts = Counter(who1)
    regulars = {p for p, _ in counts.most_common(40)}
    idx_reg = [i for i in range(len(E1)) if who1[i] in regulars]
    strangers = [p for p, n in counts.items() if p not in regulars]
    rng.shuffle(strangers)
    idx_str = [next(i for i in range(len(E1)) if who1[i] == p) for p in strangers[:300]]
    lib = np.array(idx_reg + idx_str)
    for run in range(3):
        groups, asks = group(E1[lib], rng.permutation(len(lib)))
        report(groups, who1[lib], asks, f'phone-like library, order {run + 1}')


if __name__ == '__main__':
    main()
