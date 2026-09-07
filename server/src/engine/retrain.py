#!/usr/bin/env python3
"""Guide step 7 — learning layer.

Binary classification on stored feature vectors (NOT deep learning):
- Label 1: recipe the user saved, cooked, or rated positively.
- Label 0: recipe the user skipped or rated negatively.
- Excluded: "shown"-only / "viewed" rows (no clear signal).
- Features: the vector recorded in Interaction.features when shown
  (latest "shown" row per recipe). No formula duplication with features.js.
- Model: sklearn LogisticRegression. Coefficients -> abs-normalized weights
  (sum to 1) upserted into recommendation_weights for the user.
- Minimum data: >=15 positive AND >=5 negative examples, else refuse
  (exit 2, weights untouched).

Usage:
    python3 retrain.py --db /path/to/dev.db [--user-id local] [--dry-run]
    python3 -m pip install -r requirements.txt   # one-time sklearn install

DB access uses the sqlite3 stdlib only (no ORM dependency).
"""

import argparse
import json
import os
import sqlite3
import sys

FEATURE_NAMES = [
    "ingredient_overlap",
    "cuisine_match",
    "time_fit",
    "nutrition_fit",
    "spice_fit",
    "budget_fit",
]

POSITIVE = {"saved", "cooked", "rated_positive", "rated"}
NEGATIVE = {"skipped", "rated_negative"}
NO_SIGNAL = {"shown", "viewed"}

MIN_POSITIVE = 15
MIN_NEGATIVE = 5


def resolve_db(path_arg):
    if path_arg:
        return path_arg
    env = os.environ.get("DATABASE_URL", "")
    if env.startswith("file:"):
        p = env[len("file:") :]
        if not os.path.isabs(p):
            # Prisma resolves relative SQLite paths against the prisma/ dir.
            here = os.path.dirname(os.path.abspath(__file__))
            p = os.path.normpath(os.path.join(here, "..", "..", "..", "prisma", p))
        return p
    raise SystemExit("no --db given and DATABASE_URL is not a file: URL")


def load_training_rows(conn):
    """Return (X, y) aggregated per recipe, or ([], []) if below threshold."""
    cur = conn.cursor()
    shown = cur.execute(
        "SELECT recipeId, features FROM Interaction WHERE action = 'shown' ORDER BY id DESC"
    ).fetchall()
    latest_features = {}
    for recipe_id, features_json in shown:
        if recipe_id not in latest_features:
            try:
                vec = json.loads(features_json or "{}")
            except json.JSONDecodeError:
                continue
            if all(k in vec for k in FEATURE_NAMES):
                latest_features[recipe_id] = [float(vec[k]) for k in FEATURE_NAMES]

    outcomes = cur.execute(
        "SELECT recipeId, action FROM Interaction WHERE action != 'shown'"
    ).fetchall()
    label = {}
    for recipe_id, action in outcomes:
        if action in POSITIVE:
            label[recipe_id] = 1
        elif action in NEGATIVE and recipe_id not in label:
            # A later positive overrides an earlier negative (same rule as
            # the /saved endpoint: latest outcome per recipe wins).
            label[recipe_id] = 0

    X, y = [], []
    for recipe_id, lab in label.items():
        if recipe_id in latest_features:
            X.append(latest_features[recipe_id])
            y.append(lab)
    return X, y


def normalize_abs(coefs):
    total = sum(abs(float(c)) for c in coefs)
    if total <= 0:
        n = len(coefs)
        return [1.0 / n] * n
    return [abs(float(c)) / total for c in coefs]


def main():
    ap = argparse.ArgumentParser(description="Retrain Flavora per-user weights")
    ap.add_argument("--db", default=None)
    ap.add_argument("--user-id", default="local")
    ap.add_argument("--min-positive", type=int, default=MIN_POSITIVE)
    ap.add_argument("--min-negative", type=int, default=MIN_NEGATIVE)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    db_path = resolve_db(args.db)
    if not os.path.exists(db_path):
        print(json.dumps({"status": "refused", "reason": f"db not found: {db_path}"}))
        return 2

    conn = sqlite3.connect(db_path)
    try:
        X, y = load_training_rows(conn)
    finally:
        conn.close()

    n_pos = sum(y)
    n_neg = len(y) - n_pos
    if n_pos < args.min_positive or n_neg < args.min_negative:
        print(
            json.dumps(
                {
                    "status": "refused",
                    "reason": "below minimum data threshold",
                    "positive": n_pos,
                    "negative": n_neg,
                    "minPositive": args.min_positive,
                    "minNegative": args.min_negative,
                }
            )
        )
        return 2

    try:
        from sklearn.linear_model import LogisticRegression
    except ImportError:
        print(
            json.dumps(
                {
                    "status": "error",
                    "reason": "scikit-learn not installed; run: python3 -m pip install -r requirements.txt",
                }
            )
        )
        return 1

    model = LogisticRegression(max_iter=1000)
    model.fit(X, y)
    weights = dict(zip(FEATURE_NAMES, normalize_abs(model.coef_[0])))

    if not args.dry_run:
        conn = sqlite3.connect(db_path)
        try:
            for name, value in weights.items():
                conn.execute(
                    """INSERT INTO RecommendationWeights (userId, featureName, weightValue, updatedAt)
                       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                       ON CONFLICT (userId, featureName)
                       DO UPDATE SET weightValue = excluded.weightValue,
                                     updatedAt = CURRENT_TIMESTAMP""",
                    (args.user_id, name, value),
                )
            conn.commit()
        finally:
            conn.close()

    print(
        json.dumps(
            {
                "status": "ok",
                "dryRun": args.dry_run,
                "positive": n_pos,
                "negative": n_neg,
                "weights": weights,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
