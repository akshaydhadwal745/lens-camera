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

MERGE, MATCH = 0.45, 0.363


def group(E, order):
    """Average linkage via each group's UNnormalised mean: mean(e . m_i) = e . mean(m_i), exactly."""
    sums = np.zeros((0, E.shape[1]))
    counts, members, asks = [], [], 0
    for i in order:
        if counts:
            scores = (sums / np.array(counts)[:, None]) @ E[i]
            g = int(scores.argmax()); score = float(scores[g])
        else:
            score = -1.0
        if score >= MERGE:
            sums[g] += E[i]; counts[g] += 1; members[g].append(i)
        else:
            if score >= MATCH:
                asks += 1
            sums = np.vstack([sums, E[i]]); counts.append(1); members.append([i])
    # Consolidation: merge groups whose average linkage (mean . mean) >= MERGE, best pair first.
    while True:
        means = sums / np.array(counts)[:, None]
        sim = means @ means.T
        np.fill_diagonal(sim, -1)
        a, b = np.unravel_index(sim.argmax(), sim.shape)
        if sim[a, b] < MERGE:
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
        report(groups, who, asks, f'order {run + 1}')


if __name__ == '__main__':
    main()
