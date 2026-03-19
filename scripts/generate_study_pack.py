from __future__ import annotations

import json
import math
import random
from collections import defaultdict
from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_CANDIDATES = [
    Path(os.environ["FLAVOR_CHARTER_USERS_JSON"])
    if "FLAVOR_CHARTER_USERS_JSON" in os.environ
    else None,
    REPO_ROOT / "data" / "users.json",
    REPO_ROOT.parent / "FlavorCharter" / "FlavorCharterTool" / "backend" / "data" / "users.json",
    REPO_ROOT.parent / "FlavorCharterTool" / "backend" / "data" / "users.json",
]
SOURCE = next((path for path in SOURCE_CANDIDATES if path and path.exists()), None)
OUTPUT = REPO_ROOT / "public" / "study-data" / "study-pack.json"

RANDOM_SEED = 7

TASTE_KEYS = [
    "Sweetness",
    "Sourness",
    "Saltiness",
    "Bitterness",
    "Savoriness",
    "Fatness",
    "Astringency",
    "Aromaticity",
    "Texture",
    "Piquancy",
]

SENSE_LABELS = {
    "Sweetness": "Sweet",
    "Sourness": "Sour",
    "Saltiness": "Salty",
    "Bitterness": "Bitter",
    "Savoriness": "Savory",
    "Fatness": "Fatty",
    "Astringency": "Astringent",
    "Aromaticity": "Aromatic",
    "Texture": "Texture",
    "Piquancy": "Piquant",
}

LIKERT_OPTIONS = ["1", "2", "3", "4", "5"]


@dataclass
class FoodSummary:
    food: str
    count: int
    means: dict[str, float]
    stdevs: dict[str, float]
    distribution: dict[str, dict[str, dict[str, float]]]
    outliers: dict[str, list[int]]
    outlier_counts: dict[str, int]


@dataclass
class SummaryCandidate:
    summary: FoodSummary
    answer_key: str
    margin: float
    difficulty: str


@dataclass
class ComparisonCandidate:
    food: str
    subgroup_key: str
    subgroup_label: str
    count: int
    baseline: FoodSummary
    subgroup_summary: FoodSummary
    answer_key: str
    margin: float
    difficulty: str


def load_users() -> dict[str, Any]:
    if SOURCE is None:
        searched = "\n".join(
            f"- {path}" for path in SOURCE_CANDIDATES if path is not None
        )
        raise FileNotFoundError(
            "Could not find users.json. Searched:\n"
            f"{searched}\n\n"
            "Set FLAVOR_CHARTER_USERS_JSON to the dataset path if needed."
        )
    with SOURCE.open() as handle:
        return json.load(handle)


def get_numeric_values(ratings: list[dict[str, Any]], key: str) -> list[float]:
    return [float(r[key]) for r in ratings if isinstance(r.get(key), (int, float))]


def compute_summary(food: str, ratings: list[dict[str, Any]]) -> FoodSummary:
    means: dict[str, float] = {}
    stdevs: dict[str, float] = {}
    distribution: dict[str, dict[str, dict[str, float]]] = {}
    outliers: dict[str, list[int]] = {}
    outlier_counts: dict[str, int] = {}

    for key in TASTE_KEYS:
        vals = get_numeric_values(ratings, key)
        if not vals:
            means[key] = 0.0
            stdevs[key] = 0.0
            distribution[key] = {
                str(level): {"count": 0, "percent": 0.0} for level in range(6)
            }
            outliers[key] = []
            outlier_counts[key] = 0
            continue

        mean = sum(vals) / len(vals)
        variance = sum((value - mean) ** 2 for value in vals) / len(vals)
        stdev = math.sqrt(variance)

        means[key] = round(mean, 2)
        stdevs[key] = round(stdev, 2)

        counts = {str(level): 0 for level in range(6)}
        outlier_levels: set[int] = set()
        outlier_count = 0

        for value in vals:
            level = int(value)
            if str(level) in counts:
                counts[str(level)] += 1
            if stdev > 0 and abs(value - mean) > 2 * stdev:
                outlier_levels.add(level)
                outlier_count += 1

        distribution[key] = {
            str(level): {
                "count": counts[str(level)],
                "percent": round((counts[str(level)] / len(vals)) * 100, 1),
            }
            for level in range(6)
        }
        outliers[key] = sorted(outlier_levels)
        outlier_counts[key] = outlier_count

    return FoodSummary(
        food=food,
        count=len(ratings),
        means=means,
        stdevs=stdevs,
        distribution=distribution,
        outliers=outliers,
        outlier_counts=outlier_counts,
    )


def build_food_maps(users: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    foods: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for user in users.values():
        for rating in user.get("ratings", []):
            food = rating.get("Food")
            if food:
                foods[str(food).strip()].append(rating)
    return foods


def normalize_demo_value(value: Any) -> str:
    return str(value or "").strip().lower()


def display_label(field: str, value: str) -> str:
    pretty = value.replace("_", " ").strip()
    if field == "gender":
        return f"{pretty.title()} participants"
    return f"{pretty.title()} participants"


def build_subgroup_maps(
    users: dict[str, Any],
) -> dict[tuple[str, str], dict[str, list[dict[str, Any]]]]:
    food_subgroups: dict[tuple[str, str], dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    allowed_fields = {
        "gender": {"male", "female"},
        "nationality": {"indian", "italian", "american"},
        "ethnicity": {"south_asian", "non_hispanic_white", "hispanic_latino"},
        "race": {"asian", "white", "hispanic_or_latino"},
    }
    for user in users.values():
        demographics = user.get("demographics") or {}
        for rating in user.get("ratings", []):
            food = rating.get("Food")
            if not food:
                continue
            food_name = str(food).strip()
            for field, allowed_values in allowed_fields.items():
                value = normalize_demo_value(demographics.get(field))
                if value in allowed_values:
                    food_subgroups[(field, value)][food_name].append(rating)
    return food_subgroups


def classify_difficulty(margin: float, *, easy: float, medium: float) -> str:
    if margin >= easy:
        return "easy"
    if margin >= medium:
        return "medium"
    return "hard"


def select_top_candidate(
    values: dict[str, float | int],
    *,
    minimum_margin: float,
    minimum_top_value: float | None = None,
) -> tuple[str | None, float | None]:
    ordered = sorted(values.items(), key=lambda item: item[1], reverse=True)
    if len(ordered) < 2:
        return None, None
    best_key, best_value = ordered[0]
    second_value = ordered[1][1]
    margin = float(best_value - second_value)
    if minimum_top_value is not None and float(best_value) < minimum_top_value:
        return None, None
    if best_value == second_value or margin < minimum_margin:
        return None, None
    return best_key, margin


def make_trial(
    *,
    trial_id: str,
    block_id: str,
    part_id: str,
    kind: str,
    chart_type: str,
    task_type: str,
    prompt: str,
    options: list[str],
    correct_answer: str,
    stimulus: dict[str, Any],
    difficulty: str | None = None,
    clarity_margin: float | None = None,
) -> dict[str, Any]:
    trial = {
        "id": trial_id,
        "blockId": block_id,
        "partId": part_id,
        "kind": kind,
        "chartType": chart_type,
        "taskType": task_type,
        "prompt": prompt,
        "options": options,
        "correctAnswer": correct_answer,
        "stimulus": stimulus,
    }
    if difficulty is not None:
        trial["difficulty"] = difficulty
    if clarity_margin is not None:
        trial["clarityMargin"] = round(clarity_margin, 2)
    return trial


def outlier_stimulus(summary: FoodSummary) -> dict[str, Any]:
    return {
        "foodName": summary.food,
        "count": summary.count,
        "senses": SENSE_LABELS,
        "valueRange": {"min": 0, "max": 5},
        "meanValues": summary.means,
        "stdevs": summary.stdevs,
        "distribution": summary.distribution,
        "outliers": summary.outliers,
    }


def comparison_stimulus(candidate: ComparisonCandidate) -> dict[str, Any]:
    return {
        "foodName": candidate.food,
        "count": candidate.count,
        "senses": SENSE_LABELS,
        "valueRange": {"min": 0, "max": 5},
        "baselineMean": candidate.baseline.means,
        "baselineStDev": candidate.baseline.stdevs,
        "compareMean": candidate.subgroup_summary.means,
        "subgroupLabel": candidate.subgroup_label,
    }


def trial_food_name(trial: dict[str, Any]) -> str:
    return str(trial.get("stimulus", {}).get("foodName", ""))


def trial_task_type(trial: dict[str, Any]) -> str:
    return str(trial.get("taskType", ""))


def order_trials(trials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    remaining = trials[:]
    ordered: list[dict[str, Any]] = []

    while remaining:
        previous = ordered[-1] if ordered else None
        recent_pairs = {
            (trial_food_name(trial), trial_task_type(trial))
            for trial in ordered[-2:]
        }

        def score(candidate: dict[str, Any]) -> tuple[int, int, int, int, int, str]:
            same_food = int(
                previous is not None
                and trial_food_name(candidate) == trial_food_name(previous)
            )
            same_chart = int(
                previous is not None
                and candidate["chartType"] == previous["chartType"]
            )
            same_task = int(
                previous is not None
                and trial_task_type(candidate) == trial_task_type(previous)
            )
            same_task_streak = int(
                len(ordered) >= 2
                and ordered[-1]["taskType"] == ordered[-2]["taskType"] == candidate["taskType"]
            )
            same_food_task_recent = int(
                (trial_food_name(candidate), trial_task_type(candidate)) in recent_pairs
            )
            return (
                same_food,
                same_chart,
                same_task_streak,
                same_task,
                same_food_task_recent,
                str(candidate["id"]),
            )

        next_trial = min(remaining, key=score)
        ordered.append(next_trial)
        remaining.remove(next_trial)

    return ordered


def pick_candidates(
    candidates: list[Any],
    count: int,
    key_fn,
    exclude_keys: set[str] | None = None,
) -> list[Any]:
    chosen: list[Any] = []
    seen = set(exclude_keys or set())

    for candidate in candidates:
        key = key_fn(candidate)
        if key in seen:
            continue
        chosen.append(candidate)
        seen.add(key)
        if len(chosen) == count:
            return chosen

    for candidate in candidates:
        if candidate in chosen:
            continue
        chosen.append(candidate)
        if len(chosen) == count:
            break

    return chosen


def build_ordered_trials(
    sequence: list[tuple[str, str]],
    pools: dict[tuple[str, str], list[Any]],
    build_trial,
) -> list[dict[str, Any]]:
    counters = {key: 0 for key in pools}
    ordered: list[dict[str, Any]] = []
    for index, key in enumerate(sequence, start=1):
        pool = pools[key]
        candidate = pool[counters[key]]
        counters[key] += 1
        ordered.append(build_trial(index, key, candidate))
    return ordered


def build_pack() -> dict[str, Any]:
    users = load_users()
    foods_map = build_food_maps(users)
    subgroup_map = build_subgroup_maps(users)

    overall_summaries = {
        food: compute_summary(food, ratings)
        for food, ratings in foods_map.items()
        if len(ratings) >= 18
    }
    ranked_summaries = sorted(
        overall_summaries.values(),
        key=lambda summary: (summary.count, summary.food),
        reverse=True,
    )

    mean_candidates: list[SummaryCandidate] = []
    variability_candidates: list[SummaryCandidate] = []
    comparison_higher_candidates: list[ComparisonCandidate] = []
    comparison_deviation_candidates: list[ComparisonCandidate] = []

    for summary in ranked_summaries:
        mean_key, mean_margin = select_top_candidate(
            summary.means,
            minimum_margin=0.15,
        )
        if mean_key and mean_margin is not None:
            mean_candidates.append(
                SummaryCandidate(
                    summary=summary,
                    answer_key=mean_key,
                    margin=mean_margin,
                    difficulty=classify_difficulty(mean_margin, easy=0.75, medium=0.35),
                )
            )

        variability_key, variability_margin = select_top_candidate(
            summary.stdevs,
            minimum_margin=0.10,
        )
        if variability_key and variability_margin is not None:
            variability_candidates.append(
                SummaryCandidate(
                    summary=summary,
                    answer_key=variability_key,
                    margin=variability_margin,
                    difficulty=classify_difficulty(
                        variability_margin,
                        easy=0.50,
                        medium=0.20,
                    ),
                )
            )

    for (field, subgroup_key), by_food in subgroup_map.items():
        for food, ratings in by_food.items():
            baseline = overall_summaries.get(food)
            if not baseline or len(ratings) < 8:
                continue

            subgroup_summary = compute_summary(food, ratings)
            subgroup_label = display_label(field, subgroup_key)
            higher_deltas = {
                key: subgroup_summary.means[key] - baseline.means[key]
                for key in TASTE_KEYS
                if subgroup_summary.means[key] - baseline.means[key] > 0
            }
            higher_key, higher_margin = select_top_candidate(
                higher_deltas,
                minimum_margin=0.10,
            )
            if higher_key and higher_margin is not None:
                comparison_higher_candidates.append(
                    ComparisonCandidate(
                        food=food,
                        subgroup_key=f"{field}:{subgroup_key}",
                        subgroup_label=subgroup_label,
                        count=len(ratings),
                        baseline=baseline,
                        subgroup_summary=subgroup_summary,
                        answer_key=higher_key,
                        margin=higher_margin,
                        difficulty=classify_difficulty(
                            higher_margin,
                            easy=0.50,
                            medium=0.20,
                        ),
                    )
                )

            deviation_deltas = {
                key: abs(subgroup_summary.means[key] - baseline.means[key])
                for key in TASTE_KEYS
            }
            deviation_key, deviation_margin = select_top_candidate(
                deviation_deltas,
                minimum_margin=0.10,
            )
            if deviation_key and deviation_margin is not None:
                comparison_deviation_candidates.append(
                    ComparisonCandidate(
                        food=food,
                        subgroup_key=f"{field}:{subgroup_key}",
                        subgroup_label=subgroup_label,
                        count=len(ratings),
                        baseline=baseline,
                        subgroup_summary=subgroup_summary,
                        answer_key=deviation_key,
                        margin=deviation_margin,
                        difficulty=classify_difficulty(
                            deviation_margin,
                            easy=0.50,
                            medium=0.20,
                        ),
                    )
                )

    random.seed(RANDOM_SEED)
    random.shuffle(mean_candidates)
    random.shuffle(variability_candidates)
    random.shuffle(comparison_higher_candidates)
    random.shuffle(comparison_deviation_candidates)
    comparison_higher_candidates.sort(
        key=lambda candidate: (candidate.margin, candidate.count, candidate.food),
        reverse=True,
    )
    comparison_deviation_candidates.sort(
        key=lambda candidate: (candidate.margin, candidate.count, candidate.food),
        reverse=True,
    )

    part1_practice_bar = mean_candidates[0]
    part1_practice_violin = pick_candidates(
        variability_candidates,
        1,
        lambda candidate: candidate.summary.food,
        exclude_keys={part1_practice_bar.summary.food},
    )[0]
    part1_practice_radial = pick_candidates(
        mean_candidates[1:] + mean_candidates[:1],
        1,
        lambda candidate: candidate.summary.food,
        exclude_keys={
            part1_practice_bar.summary.food,
            part1_practice_violin.summary.food,
        },
    )[0]

    part2_practice_overlaid = comparison_higher_candidates[0]
    part2_practice_zglyph = pick_candidates(
        comparison_deviation_candidates,
        1,
        lambda candidate: candidate.food,
        exclude_keys={part2_practice_overlaid.food},
    )[0]

    used_part1_foods = {
        part1_practice_bar.summary.food,
        part1_practice_violin.summary.food,
        part1_practice_radial.summary.food,
    }
    used_part2_foods = {
        part2_practice_overlaid.food,
        part2_practice_zglyph.food,
    }

    mean_grouped = pick_candidates(
        mean_candidates[1:],
        2,
        lambda candidate: candidate.summary.food,
        exclude_keys=used_part1_foods,
    )
    mean_radial = pick_candidates(
        mean_candidates[1:],
        2,
        lambda candidate: candidate.summary.food,
        exclude_keys=used_part1_foods | {candidate.summary.food for candidate in mean_grouped},
    )
    variability_violin = pick_candidates(
        variability_candidates,
        2,
        lambda candidate: candidate.summary.food,
        exclude_keys=used_part1_foods | {candidate.summary.food for candidate in mean_grouped + mean_radial},
    )
    variability_radial = pick_candidates(
        variability_candidates,
        2,
        lambda candidate: candidate.summary.food,
        exclude_keys=used_part1_foods
        | {candidate.summary.food for candidate in mean_grouped + mean_radial + variability_violin},
    )

    higher_overlaid = pick_candidates(
        comparison_higher_candidates[1:],
        2,
        lambda candidate: candidate.food,
        exclude_keys=used_part2_foods,
    )
    higher_zglyph = pick_candidates(
        comparison_higher_candidates[1:],
        2,
        lambda candidate: candidate.food,
        exclude_keys=used_part2_foods | {candidate.food for candidate in higher_overlaid},
    )
    deviation_overlaid = pick_candidates(
        comparison_deviation_candidates,
        2,
        lambda candidate: candidate.food,
        exclude_keys=used_part2_foods | {candidate.food for candidate in higher_overlaid + higher_zglyph},
    )
    deviation_zglyph = pick_candidates(
        comparison_deviation_candidates,
        2,
        lambda candidate: candidate.food,
        exclude_keys=used_part2_foods
        | {candidate.food for candidate in higher_overlaid + higher_zglyph + deviation_overlaid},
    )

    part1_practice = [
        make_trial(
            trial_id="part1-practice-1",
            block_id="part1",
            part_id="part1",
            kind="practice",
            chart_type="grouped_bar",
            task_type="highest_mean",
            prompt="Which taste dimension has the highest mean rating for this food?",
            options=list(SENSE_LABELS.values()),
            correct_answer=SENSE_LABELS[part1_practice_bar.answer_key],
            stimulus=outlier_stimulus(part1_practice_bar.summary),
            difficulty=part1_practice_bar.difficulty,
            clarity_margin=part1_practice_bar.margin,
        ),
        make_trial(
            trial_id="part1-practice-2",
            block_id="part1",
            part_id="part1",
            kind="practice",
            chart_type="violin_plot",
            task_type="highest_variability",
            prompt="Which attribute shows the greatest variability in ratings?",
            options=list(SENSE_LABELS.values()),
            correct_answer=SENSE_LABELS[part1_practice_violin.answer_key],
            stimulus=outlier_stimulus(part1_practice_violin.summary),
            difficulty=part1_practice_violin.difficulty,
            clarity_margin=part1_practice_violin.margin,
        ),
        make_trial(
            trial_id="part1-practice-3",
            block_id="part1",
            part_id="part1",
            kind="practice",
            chart_type="outlier_radar",
            task_type="highest_mean",
            prompt="Which taste dimension has the highest mean rating for this food?",
            options=list(SENSE_LABELS.values()),
            correct_answer=SENSE_LABELS[part1_practice_radial.answer_key],
            stimulus=outlier_stimulus(part1_practice_radial.summary),
            difficulty=part1_practice_radial.difficulty,
            clarity_margin=part1_practice_radial.margin,
        )
    ]

    part2_practice = [
        make_trial(
            trial_id="part2-practice-1",
            block_id="part2",
            part_id="part2",
            kind="practice",
            chart_type="overlaid_radar",
            task_type="higher_than_baseline",
            prompt="For this food, which attribute is rated higher by the subgroup than the baseline?",
            options=list(SENSE_LABELS.values()),
            correct_answer=SENSE_LABELS[part2_practice_overlaid.answer_key],
            stimulus=comparison_stimulus(part2_practice_overlaid),
            difficulty=part2_practice_overlaid.difficulty,
            clarity_margin=part2_practice_overlaid.margin,
        ),
        make_trial(
            trial_id="part2-practice-2",
            block_id="part2",
            part_id="part2",
            kind="practice",
            chart_type="zglyph",
            task_type="largest_deviation",
            prompt="For this food, which attribute differs the most between the subgroup and the baseline?",
            options=list(SENSE_LABELS.values()),
            correct_answer=SENSE_LABELS[part2_practice_zglyph.answer_key],
            stimulus=comparison_stimulus(part2_practice_zglyph),
            difficulty=part2_practice_zglyph.difficulty,
            clarity_margin=part2_practice_zglyph.margin,
        )
    ]

    part1_real = build_ordered_trials(
        [
            ("grouped_bar", "highest_mean"),
            ("outlier_radar", "highest_mean"),
            ("violin_plot", "highest_variability"),
            ("outlier_radar", "highest_variability"),
            ("grouped_bar", "highest_mean"),
            ("outlier_radar", "highest_mean"),
            ("violin_plot", "highest_variability"),
            ("outlier_radar", "highest_variability"),
        ],
        {
            ("grouped_bar", "highest_mean"): mean_grouped,
            ("outlier_radar", "highest_mean"): mean_radial,
            ("violin_plot", "highest_variability"): variability_violin,
            ("outlier_radar", "highest_variability"): variability_radial,
        },
        lambda index, key, candidate:
            make_trial(
                trial_id=f"part1-real-{index}",
                block_id="part1",
                part_id="part1",
                kind="real",
                chart_type=key[0],
                task_type=key[1],
                prompt=(
                    "Which taste dimension has the highest mean rating for this food?"
                    if key[1] == "highest_mean"
                    else "Which attribute shows the greatest variability in ratings?"
                ),
                options=list(SENSE_LABELS.values()),
                correct_answer=SENSE_LABELS[candidate.answer_key],
                stimulus=outlier_stimulus(candidate.summary),
                difficulty=candidate.difficulty,
                clarity_margin=candidate.margin,
            )
    )

    part2_real = build_ordered_trials(
        [
            ("overlaid_radar", "higher_than_baseline"),
            ("zglyph", "higher_than_baseline"),
            ("overlaid_radar", "largest_deviation"),
            ("zglyph", "largest_deviation"),
            ("overlaid_radar", "higher_than_baseline"),
            ("zglyph", "higher_than_baseline"),
            ("overlaid_radar", "largest_deviation"),
            ("zglyph", "largest_deviation"),
        ],
        {
            ("overlaid_radar", "higher_than_baseline"): higher_overlaid,
            ("zglyph", "higher_than_baseline"): higher_zglyph,
            ("overlaid_radar", "largest_deviation"): deviation_overlaid,
            ("zglyph", "largest_deviation"): deviation_zglyph,
        },
        lambda index, key, candidate:
            make_trial(
                trial_id=f"part2-real-{index}",
                block_id="part2",
                part_id="part2",
                kind="real",
                chart_type=key[0],
                task_type=key[1],
                prompt=(
                    "For this food, which attribute is rated higher by the subgroup than the baseline?"
                    if key[1] == "higher_than_baseline"
                    else "For this food, which attribute differs the most between the subgroup and the baseline?"
                ),
                options=list(SENSE_LABELS.values()),
                correct_answer=SENSE_LABELS[candidate.answer_key],
                stimulus=comparison_stimulus(candidate),
                difficulty=candidate.difficulty,
                clarity_margin=candidate.margin,
            )
    )

    part1_practice = order_trials(part1_practice)
    part2_practice = order_trials(part2_practice)

    part1_used_foods = {
        trial_food_name(trial) for trial in part1_practice + part1_real
    }
    part2_used_foods = {
        trial_food_name(trial) for trial in part2_practice + part2_real
    }

    part1_onboarding_summaries = pick_candidates(
        ranked_summaries,
        3,
        lambda summary: summary.food,
        exclude_keys=part1_used_foods,
    )
    part2_onboarding_candidates = pick_candidates(
        comparison_higher_candidates + comparison_deviation_candidates,
        2,
        lambda candidate: candidate.food,
        exclude_keys=part2_used_foods,
    )

    part1_onboarding_previews = [
        make_trial(
            trial_id="part1-preview-bar",
            block_id="part1",
            part_id="part1",
            kind="preview",
            chart_type="grouped_bar",
            task_type="tutorial_preview",
            prompt="Onboarding preview",
            options=[],
            correct_answer="",
            stimulus=outlier_stimulus(part1_onboarding_summaries[0]),
        ),
        make_trial(
            trial_id="part1-preview-violin",
            block_id="part1",
            part_id="part1",
            kind="preview",
            chart_type="violin_plot",
            task_type="tutorial_preview",
            prompt="Onboarding preview",
            options=[],
            correct_answer="",
            stimulus=outlier_stimulus(part1_onboarding_summaries[1]),
        ),
        make_trial(
            trial_id="part1-preview-radial",
            block_id="part1",
            part_id="part1",
            kind="preview",
            chart_type="outlier_radar",
            task_type="tutorial_preview",
            prompt="Onboarding preview",
            options=[],
            correct_answer="",
            stimulus=outlier_stimulus(part1_onboarding_summaries[2]),
        ),
    ]

    part2_onboarding_previews = [
        make_trial(
            trial_id="part2-preview-overlaid",
            block_id="part2",
            part_id="part2",
            kind="preview",
            chart_type="overlaid_radar",
            task_type="tutorial_preview",
            prompt="Onboarding preview",
            options=[],
            correct_answer="",
            stimulus=comparison_stimulus(part2_onboarding_candidates[0]),
        ),
        make_trial(
            trial_id="part2-preview-zglyph",
            block_id="part2",
            part_id="part2",
            kind="preview",
            chart_type="zglyph",
            task_type="tutorial_preview",
            prompt="Onboarding preview",
            options=[],
            correct_answer="",
            stimulus=comparison_stimulus(part2_onboarding_candidates[1]),
        ),
    ]

    return {
        "title": "Usability Study for Flavor Encodings",
        "responseEndpoint": "",
        "consentText": [
            "**You are invited to participate in a research study on data visualization.**",
            "The purpose of this study is to evaluate how different chart designs support interpretation of flavor-related data.",
            "You will be asked to answer questions based on information shown in charts.",
            "**The study will take approximately 8-12 minutes to complete.**",
            "**We will record your responses and response times.**",
            "**This study evaluates chart readability and task support, not personal ability.**",
            "**Your participation is voluntary, and you may stop at any time.**",
            "**All responses will be used for research purposes only and will remain anonymous.**",
        ],
        "introText": [
            "In this study, you will view different chart types that represent flavor characteristics of foods.",
            "Your task is to interpret the charts and answer questions about the information they display.",
            "**The study is divided into two parts:**",
            "**Part 1** focuses on understanding flavor summaries (mean values and variability).",
            "**Part 2** focuses on comparing subgroup differences relative to a baseline.",
            "Each part begins with a short tutorial, followed by practice trials and then main trials.",
            "**Please answer based only on the information visible in the chart.**",
            "**Work as accurately and quickly as possible.**",
        ],
        "backgroundQuestions": [
            {
                "id": "chart_familiarity",
                "label": "How familiar are you with bar charts, violin plots, and radar charts?",
                "options": [
                    "Not at all familiar",
                    "Slightly familiar",
                    "Moderately familiar",
                    "Very familiar",
                ],
            },
            {
                "id": "visualization_experience",
                "label": "How would you describe your data visualization experience?",
                "options": [
                    "Beginner",
                    "Intermediate",
                    "Advanced",
                    "Expert",
                ],
            },
        ],
        "blocks": [
            {
                "id": "part1",
                "partId": "part1",
                "title": "Part 1: Flavor Summary",
                "intro": "This part evaluates how different chart types support understanding flavor summaries. You will identify mean values and variability across taste attributes.",
                "taskInstruction": "Select the best answer based only on the information visible in the chart.",
                "onboarding": [
                    {
                        "chartType": "grouped_bar",
                        "title": "Grouped Bar Chart",
                        "callouts": [
                            "Taller bars indicate larger mean ratings.",
                        ],
                    },
                    {
                        "chartType": "violin_plot",
                        "title": "Violin Plot",
                        "callouts": [
                            "Wider regions indicate more ratings. Greater vertical spread indicates higher variability.",
                        ],
                    },
                    {
                        "chartType": "outlier_radar",
                        "title": "Distribution-Aware Radial Profile",
                        "callouts": [
                            "The outline shows the mean. The bands show how ratings are distributed.",
                        ],
                    },
                ],
                "onboardingPreviewTrials": part1_onboarding_previews,
                "practiceTrials": part1_practice,
                "realTrials": part1_real,
                "subjectiveSection": {
                    "id": "part1-ratings",
                    "title": "Chart Evaluation",
                    "instructions": "Please rate each chart based on your experience in this part.",
                    "charts": [
                        {"chartType": "grouped_bar", "title": "Grouped Bar Chart"},
                        {"chartType": "violin_plot", "title": "Violin Plot"},
                        {"chartType": "outlier_radar", "title": "Distribution-Aware Radial Profile"},
                    ],
                    "questions": [
                        {
                            "id": "easy_find_info",
                            "label": "This chart made it easy to identify the requested information.",
                        },
                        {
                            "id": "confidence",
                            "label": "I felt confident in my answers when using this chart.",
                        },
                        {
                            "id": "clear_differences",
                            "label": "This chart clearly showed differences across taste attributes.",
                        },
                        {
                            "id": "visual_clutter",
                            "label": "This chart felt visually cluttered.",
                        },
                    ],
                    "scaleOptions": LIKERT_OPTIONS,
                },
            },
            {
                "id": "part2",
                "partId": "part2",
                "title": "Part 2: Subgroup Comparison",
                "intro": "This part evaluates how chart types support comparison between a subgroup and a baseline. You will identify differences across taste attributes.",
                "taskInstruction": "Select the best answer based only on the information visible in the chart.",
                "onboarding": [
                    {
                        "chartType": "overlaid_radar",
                        "title": "Overlaid Radar Chart",
                        "callouts": [
                            "Compare the two profiles to identify differences across attributes.",
                        ],
                    },
                    {
                        "chartType": "zglyph",
                        "title": "Z-Score Radar Chart",
                        "callouts": [
                            "Direction shows above or below baseline. Larger displacement indicates larger differences.",
                        ],
                    },
                ],
                "onboardingPreviewTrials": part2_onboarding_previews,
                "practiceTrials": part2_practice,
                "realTrials": part2_real,
                "subjectiveSection": {
                    "id": "part2-ratings",
                    "title": "Chart Evaluation",
                    "instructions": "Please rate each chart based on your experience in this part.",
                    "charts": [
                        {"chartType": "overlaid_radar", "title": "Overlaid Radar Chart"},
                        {"chartType": "zglyph", "title": "Z-Score Radar Chart"},
                    ],
                    "questions": [
                        {
                            "id": "easy_compare",
                            "label": "This chart made it easy to identify differences between the subgroup and baseline.",
                        },
                        {
                            "id": "confidence",
                            "label": "I felt confident in my answers when using this chart.",
                        },
                        {
                            "id": "clear_difference",
                            "label": "This chart clearly showed how the subgroup differs from the baseline.",
                        },
                        {
                            "id": "visual_clutter",
                            "label": "This chart felt visually cluttered.",
                        },
                    ],
                    "scaleOptions": LIKERT_OPTIONS,
                },
            },
        ],
        "finalPreferenceQuestions": [
            {
                "id": "preferred_mean",
                "label": "Which chart did you prefer for identifying highest mean values?",
                "options": [
                    "Grouped Bar Chart",
                    "Distribution-Aware Radial Profile",
                ],
            },
            {
                "id": "preferred_variability",
                "label": "Which chart did you prefer for understanding variability?",
                "options": [
                    "Violin Plot",
                    "Distribution-Aware Radial Profile",
                ],
            },
            {
                "id": "preferred_subgroup",
                "label": "Which chart did you prefer for comparing subgroup differences?",
                "options": [
                    "Overlaid Radar Chart",
                    "Z-Score Radar Chart",
                ],
            },
        ],
        "finalCommentPrompt": "Additional comments (optional)",
    }


def print_developer_summary(pack: dict[str, Any]) -> None:
    print("Selected trial summary:")
    for block in pack["blocks"]:
        for trial in block["practiceTrials"] + block["realTrials"]:
            stimulus = trial["stimulus"]
            print(
                " - "
                f"{block['id']} | task={trial['taskType']} | chart={trial['chartType']} | "
                f"food={stimulus['foodName']} | answer={trial['correctAnswer']} | "
                f"margin={trial.get('clarityMargin', 'n/a')} | difficulty={trial.get('difficulty', 'n/a')}"
            )


def main() -> None:
    pack = build_pack()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w") as handle:
        json.dump(pack, handle, indent=2)
        handle.write("\n")
    print(f"Wrote {OUTPUT.relative_to(REPO_ROOT)}")
    print_developer_summary(pack)


if __name__ == "__main__":
    main()
