from __future__ import annotations

import itertools
import json
import math
import os
import random
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


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
MIN_FOOD_RATINGS = 18
MIN_GROUP_RATINGS = 8

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

CHART_FOOTPRINTS = {
    "distribution_radar": {"width": 520, "height": 360, "approximateArea": 187200},
    "histogram_small_multiples": {
        "width": 520,
        "height": 360,
        "approximateArea": 187200,
    },
    "stacked_bar_distribution": {
        "width": 520,
        "height": 360,
        "approximateArea": 187200,
    },
    "zchart": {"width": 520, "height": 360, "approximateArea": 187200},
    "dual_histogram": {"width": 520, "height": 360, "approximateArea": 187200},
}

BLOCK1_MIN_SUPPORT_SCORE = 0.45
BLOCK1_MIN_TOP3_AVG = 0.62
BLOCK1_MIN_MARGIN = 0.06
PROFILE_MIN_MEMBER_ADVANTAGE = 0.08
DOMINANT_PROFILE_MIN_MATCH_STRENGTH = 1.45
SPATIAL_PROFILE_MIN_MATCH_STRENGTH = 0.75
BLOCK4_MIN_TUPLE_STRENGTH = 0.7
BLOCK4_MIN_MARGIN = 0.14
BLOCK5_SIGNIFICANT_MIN_OVERALL = 0.62
BLOCK5_SIGNIFICANT_MIN_TOP = 1.05
BLOCK5_SUBTLE_MAX_OVERALL = 0.25
BLOCK5_SUBTLE_MAX_TOP = 0.5


@dataclass
class FoodSummary:
    food: str
    count: int
    means: dict[str, float]
    stdevs: dict[str, float]
    distribution: dict[str, dict[str, dict[str, float]]]


@dataclass
class TupleCandidate:
    summary: FoodSummary
    correct_keys: tuple[str, ...]
    options: list[str]
    clarity_margin: float
    difficulty: str
    notes: list[str]


@dataclass
class MultiFoodCandidate:
    stimulus_id: str
    foods: list[FoodSummary]
    target_keys: tuple[str, ...]
    correct_indices: list[int]
    clarity_margin: float
    difficulty: str
    notes: list[str]


@dataclass
class PopulationComparisonCandidate:
    stimulus_id: str
    food: str
    comparison_label: str
    population_a_id: str
    population_a_label: str
    population_a_summary: FoodSummary
    population_b_id: str
    population_b_label: str
    population_b_summary: FoodSummary
    correct_keys: tuple[str, ...]
    options: list[str]
    clarity_margin: float
    difficulty: str
    notes: list[str]
    magnitude_label: str | None = None


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

    for key in TASTE_KEYS:
        vals = get_numeric_values(ratings, key)
        if not vals:
            means[key] = 0.0
            stdevs[key] = 0.0
            distribution[key] = {
                str(level): {"count": 0, "percent": 0.0} for level in range(6)
            }
            continue

        mean = sum(vals) / len(vals)
        variance = sum((value - mean) ** 2 for value in vals) / len(vals)
        stdev = math.sqrt(variance)

        counts = {str(level): 0 for level in range(6)}
        for value in vals:
            level = int(value)
            if str(level) in counts:
                counts[str(level)] += 1

        means[key] = round(mean, 2)
        stdevs[key] = round(stdev, 2)
        distribution[key] = {
            str(level): {
                "count": counts[str(level)],
                "percent": round((counts[str(level)] / len(vals)) * 100, 1),
            }
            for level in range(6)
        }

    return FoodSummary(
        food=food,
        count=len(ratings),
        means=means,
        stdevs=stdevs,
        distribution=distribution,
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
        if pretty == "female":
            return "Female Participants"
        if pretty == "male":
            return "Rest of the Population"
        return "Participants"
    return f"{pretty.title()} participants"


def build_group_maps(
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


def percent(summary: FoodSummary, key: str, levels: Iterable[int]) -> float:
    return sum(summary.distribution[key][str(level)]["percent"] for level in levels) / 100


def support_score(summary: FoodSummary, key: str) -> float:
    high = percent(summary, key, [4, 5])
    mid = percent(summary, key, [3])
    low = percent(summary, key, [0, 1])
    concentration = (
        max(summary.distribution[key][str(level)]["percent"] for level in range(6)) / 100
    )
    return high + 0.45 * concentration + 0.2 * mid - 0.18 * low


def difference_score(a: FoodSummary, b: FoodSummary, key: str) -> float:
    return abs(a.means[key] - b.means[key])


def overall_difference_score(a: FoodSummary, b: FoodSummary) -> float:
    return sum(difference_score(a, b, key) for key in TASTE_KEYS) / len(TASTE_KEYS)


def rank_keys_by_score(summary: FoodSummary) -> list[tuple[str, float]]:
    return sorted(
        ((key, support_score(summary, key)) for key in TASTE_KEYS),
        key=lambda item: (item[1], summary.means[item[0]], item[0]),
        reverse=True,
    )


def profile_match_strength(summary: FoodSummary, target_keys: tuple[str, ...]) -> float:
    return sum(support_score(summary, key) for key in target_keys)


def top_non_target_strength(summary: FoodSummary, target_keys: tuple[str, ...]) -> float:
    ranked = rank_keys_by_score(summary)
    return max(
        (score for key, score in ranked if key not in target_keys),
        default=0.0,
    )


def rank_difference_keys(a: FoodSummary, b: FoodSummary) -> list[tuple[str, float]]:
    return sorted(
        ((key, difference_score(a, b, key)) for key in TASTE_KEYS),
        key=lambda item: (item[1], max(a.means[item[0]], b.means[item[0]]), item[0]),
        reverse=True,
    )


def classify_difficulty(margin: float, *, easy: float, medium: float) -> str:
    if margin >= easy:
        return "easy"
    if margin >= medium:
        return "medium"
    return "hard"


def tuple_label(keys: tuple[str, ...]) -> str:
    return ", ".join(SENSE_LABELS[key] for key in keys)


def canonical_tuple(keys: Iterable[str]) -> tuple[str, ...]:
    return tuple(sorted(keys, key=TASTE_KEYS.index))


def ensure_unique_options(correct: tuple[str, ...], option_keys: list[tuple[str, ...]]) -> list[str]:
    labels: list[str] = []
    seen = {correct}
    labels.append(tuple_label(correct))
    for option in option_keys:
        if option in seen:
            continue
        seen.add(option)
        labels.append(tuple_label(option))
        if len(labels) == 4:
            break
    return labels


def build_tuple_candidate(summary: FoodSummary) -> TupleCandidate | None:
    ranked = rank_keys_by_score(summary)
    if len(ranked) < 5:
        return None
    correct = tuple(key for key, _ in ranked[:3])
    margin = ranked[2][1] - ranked[3][1]
    top3_avg = sum(score for _, score in ranked[:3]) / 3
    if (
        ranked[2][1] < BLOCK1_MIN_SUPPORT_SCORE
        or top3_avg < BLOCK1_MIN_TOP3_AVG
        or margin < BLOCK1_MIN_MARGIN
    ):
        return None

    distractor_keys = [
        (ranked[0][0], ranked[1][0], ranked[3][0]),
        (ranked[0][0], ranked[2][0], ranked[3][0]),
        (ranked[1][0], ranked[2][0], ranked[3][0]),
        (ranked[0][0], ranked[1][0], ranked[4][0]),
        (ranked[0][0], ranked[2][0], ranked[4][0]),
        (ranked[1][0], ranked[2][0], ranked[4][0]),
    ]
    options = ensure_unique_options(correct, distractor_keys)
    if len(options) < 4:
        return None

    notes = [
        f"support={tuple_label(correct)}",
        f"top-three-vs-fourth margin={margin:.2f}",
        f"top-three-avg={top3_avg:.2f}",
    ]
    return TupleCandidate(
        summary=summary,
        correct_keys=correct,
        options=options,
        clarity_margin=round(margin, 2),
        difficulty=classify_difficulty(margin, easy=0.14, medium=0.08),
        notes=notes,
    )


def best_spatial_pair(summary: FoodSummary) -> tuple[tuple[str, str], float] | None:
    ranked = rank_keys_by_score(summary)
    top_keys = [key for key, _ in ranked[:4]]
    best_pair: tuple[str, str] | None = None
    best_score = -1.0
    for left, right in itertools.combinations(top_keys, 2):
        left_idx = TASTE_KEYS.index(left)
        right_idx = TASTE_KEYS.index(right)
        distance = abs(left_idx - right_idx)
        circular_distance = min(distance, len(TASTE_KEYS) - distance)
        if circular_distance < 3:
            continue
        pair_score = support_score(summary, left) + support_score(summary, right)
        if pair_score > best_score:
            best_score = pair_score
            best_pair = (left, right)
    if best_pair is None:
        return None
    return best_pair, best_score


def overlaps(keys: Iterable[str], target: tuple[str, ...]) -> int:
    return len(set(keys) & set(target))


def build_profile_candidates(
    summaries: list[FoodSummary],
    *,
    mode: str,
    needed: int,
) -> list[MultiFoodCandidate]:
    def signature_for_summary(summary: FoodSummary) -> tuple[str, ...] | None:
        ranked = rank_keys_by_score(summary)
        if mode == "dominant":
            return canonical_tuple(key for key, _ in ranked[:3])
        pair = best_spatial_pair(summary)
        if pair is None:
            return None
        return canonical_tuple(pair[0])

    signatures: dict[tuple[str, ...], list[FoodSummary]] = defaultdict(list)
    for summary in summaries:
        signature = signature_for_summary(summary)
        if signature is not None:
            signatures[signature].append(summary)

    candidates: list[MultiFoodCandidate] = []
    for target_keys, matches in signatures.items():
        if len(matches) < 2:
            continue
        ordered_matches = sorted(matches, key=lambda item: (-item.count, item.food))
        chosen_matches = ordered_matches[:2]

        match_strengths = [profile_match_strength(summary, target_keys) for summary in chosen_matches]
        weakest_match_strength = min(match_strengths)

        distractor_pool = []
        for summary in summaries:
            if summary.food in {item.food for item in chosen_matches}:
                continue
            summary_keys = signature_for_summary(summary)
            if summary_keys is None:
                continue

            shared = overlaps(summary_keys, target_keys)
            if shared == len(target_keys):
                continue
            target_strength = profile_match_strength(summary, target_keys)
            distractor_pool.append((shared, target_strength, summary.count, summary))

        if len(distractor_pool) < 3:
            continue

        viable_distractors = [
            item
            for item in distractor_pool
            if item[1] <= weakest_match_strength - PROFILE_MIN_MEMBER_ADVANTAGE
        ]
        if len(viable_distractors) < 3:
            continue

        viable_distractors.sort(key=lambda item: (-item[0], -item[1], -item[2], item[3].food))
        selected_distractors = [item[3] for item in viable_distractors[:3]]
        displayed = chosen_matches + selected_distractors
        random.Random(f"{mode}:{target_keys}").shuffle(displayed)
        correct_indices = sorted(
            item + 1
            for item, summary in enumerate(displayed)
            if summary.food in {match.food for match in chosen_matches}
        )

        max_distractor_overlap = max(
            overlaps(signature_for_summary(summary) or (), target_keys)
            for summary in selected_distractors
        )
        distractor_strengths = [
            profile_match_strength(summary, target_keys) for summary in selected_distractors
        ]
        weakest_match_strength = min(match_strengths)
        strongest_distractor_strength = max(distractor_strengths)
        member_advantage = weakest_match_strength - strongest_distractor_strength
        clarity_margin = min(
            max(0.0, len(target_keys) - max_distractor_overlap),
            round(member_advantage, 2),
        )
        min_match_strength = (
            DOMINANT_PROFILE_MIN_MATCH_STRENGTH
            if mode == "dominant"
            else SPATIAL_PROFILE_MIN_MATCH_STRENGTH
        )
        if (
            max_distractor_overlap >= len(target_keys)
            or weakest_match_strength < min_match_strength
            or member_advantage < PROFILE_MIN_MEMBER_ADVANTAGE
        ):
            continue

        label = " and ".join(SENSE_LABELS[key] for key in target_keys)
        notes = [
            f"target={label}",
            f"matches={', '.join(match.food for match in chosen_matches)}",
            f"distractor-overlap-max={max_distractor_overlap}",
            f"weakest-match-strength={weakest_match_strength:.2f}",
            f"strongest-distractor-strength={strongest_distractor_strength:.2f}",
            f"member-advantage={member_advantage:.2f}",
        ]
        candidates.append(
            MultiFoodCandidate(
                stimulus_id=f"{mode}-{'-'.join(target_keys)}-{'-'.join(match.food for match in chosen_matches)}",
                foods=displayed,
                target_keys=target_keys,
                correct_indices=correct_indices,
                clarity_margin=round(clarity_margin, 2),
                difficulty=classify_difficulty(clarity_margin, easy=2.0, medium=1.5),
                notes=notes,
            )
        )

    candidates.sort(
        key=lambda item: (
            item.clarity_margin,
            sum(food.count for food in item.foods),
            tuple(food.food for food in item.foods),
        ),
        reverse=True,
    )
    return candidates[: max(needed * 3, needed)]


def build_population_candidates(
    group_maps: dict[tuple[str, str], dict[str, list[dict[str, Any]]]],
    *,
    overall_summaries: dict[str, FoodSummary],
) -> tuple[list[PopulationComparisonCandidate], list[PopulationComparisonCandidate]]:
    by_field: dict[str, list[str]] = defaultdict(list)
    for field, value in group_maps:
        by_field[field].append(value)

    tuple_candidates: list[PopulationComparisonCandidate] = []
    size_candidates: list[PopulationComparisonCandidate] = []

    for field, values in by_field.items():
        unique_values = sorted(set(values))
        for left, right in itertools.combinations(unique_values, 2):
            left_map = group_maps[(field, left)]
            right_map = group_maps[(field, right)]
            common_foods = sorted(set(left_map) & set(right_map))
            for food in common_foods:
                left_ratings = left_map[food]
                right_ratings = right_map[food]
                if len(left_ratings) < MIN_GROUP_RATINGS or len(right_ratings) < MIN_GROUP_RATINGS:
                    continue

                left_summary = compute_summary(food, left_ratings)
                right_summary = compute_summary(food, right_ratings)
                ranked = rank_difference_keys(left_summary, right_summary)
                if len(ranked) < 4:
                    continue

                correct = (ranked[0][0], ranked[1][0])
                tuple_margin = ranked[1][1] - ranked[2][1]
                tuple_strength = (ranked[0][1] + ranked[1][1]) / 2
                if (
                    tuple_strength >= BLOCK4_MIN_TUPLE_STRENGTH
                    and tuple_margin >= BLOCK4_MIN_MARGIN
                ):
                    distractors = [
                        (ranked[0][0], ranked[2][0]),
                        (ranked[1][0], ranked[2][0]),
                        (ranked[0][0], ranked[3][0]),
                        (ranked[1][0], ranked[3][0]),
                    ]
                    options = ensure_unique_options(correct, distractors)
                    if len(options) == 4:
                        tuple_candidates.append(
                            PopulationComparisonCandidate(
                                stimulus_id=f"{field}-{left}-vs-{right}-{food}",
                                food=food,
                                comparison_label=f"{display_label(field, left)} vs {display_label(field, right)}",
                                population_a_id=f"{field}:{left}",
                                population_a_label=display_label(field, left),
                                population_a_summary=left_summary,
                                population_b_id=f"{field}:{right}",
                                population_b_label=display_label(field, right),
                                population_b_summary=right_summary,
                                correct_keys=correct,
                                options=options,
                                clarity_margin=round(tuple_margin, 2),
                                difficulty=classify_difficulty(tuple_margin, easy=0.18, medium=0.1),
                                notes=[
                                    f"top-difference={tuple_label(correct)}",
                                    f"avg-top-diff={tuple_strength:.2f}",
                                    f"second-vs-third margin={tuple_margin:.2f}",
                                ],
                            )
                        )

                overall = overall_difference_score(left_summary, right_summary)
                top_diff = ranked[0][1]
                magnitude_label = None
                if overall >= BLOCK5_SIGNIFICANT_MIN_OVERALL and top_diff >= BLOCK5_SIGNIFICANT_MIN_TOP:
                    magnitude_label = "Significant"
                    margin = overall
                elif overall <= BLOCK5_SUBTLE_MAX_OVERALL and top_diff <= BLOCK5_SUBTLE_MAX_TOP:
                    magnitude_label = "Subtle"
                    margin = BLOCK5_SUBTLE_MAX_TOP - top_diff
                else:
                    continue

                size_candidates.append(
                    PopulationComparisonCandidate(
                        stimulus_id=f"magnitude-{field}-{left}-vs-{right}-{food}",
                        food=food,
                        comparison_label=f"{display_label(field, left)} vs {display_label(field, right)}",
                        population_a_id=f"{field}:{left}",
                        population_a_label=display_label(field, left),
                        population_a_summary=left_summary,
                        population_b_id=f"{field}:{right}",
                        population_b_label=display_label(field, right),
                        population_b_summary=right_summary,
                        correct_keys=(),
                        options=["Significant", "Subtle"],
                        clarity_margin=round(margin, 2),
                        difficulty=classify_difficulty(margin, easy=0.55, medium=0.32),
                        notes=[
                            f"overall-diff={overall:.2f}",
                            f"top-diff={top_diff:.2f}",
                            f"magnitude={magnitude_label}",
                        ],
                        magnitude_label=magnitude_label,
                    )
                )

    tuple_candidates.sort(
        key=lambda item: (item.clarity_margin, item.food, item.comparison_label),
        reverse=True,
    )
    size_candidates.sort(
        key=lambda item: (item.clarity_margin, item.food, item.comparison_label),
        reverse=True,
    )
    return tuple_candidates, size_candidates


def single_food_stimulus(summary: FoodSummary, stimulus_id: str) -> dict[str, Any]:
    return {
        "stimulusId": stimulus_id,
        "stimulusKind": "single_food",
        "foodName": summary.food,
        "foodNames": [summary.food],
        "count": summary.count,
        "senses": SENSE_LABELS,
        "valueRange": {"min": 0, "max": 5},
        "meanValues": summary.means,
        "stdevs": summary.stdevs,
        "distribution": summary.distribution,
    }


def multi_food_stimulus(candidate: MultiFoodCandidate) -> dict[str, Any]:
    return {
        "stimulusId": candidate.stimulus_id,
        "stimulusKind": "multi_food",
        "foodName": ", ".join(food.food for food in candidate.foods),
        "foodNames": [food.food for food in candidate.foods],
        "senses": SENSE_LABELS,
        "valueRange": {"min": 0, "max": 5},
        "targetProfileKeys": list(candidate.target_keys),
        "targetProfileLabels": [SENSE_LABELS[key] for key in candidate.target_keys],
        "foods": [
            {
                "index": index + 1,
                "foodName": food.food,
                "count": food.count,
                "meanValues": food.means,
                "stdevs": food.stdevs,
                "distribution": food.distribution,
            }
            for index, food in enumerate(candidate.foods)
        ],
    }


def comparison_stimulus(candidate: PopulationComparisonCandidate) -> dict[str, Any]:
    return {
        "stimulusId": candidate.stimulus_id,
        "stimulusKind": "population_comparison",
        "foodName": candidate.food,
        "foodNames": [candidate.food],
        "comparisonLabel": candidate.comparison_label,
        "populationA": {
            "id": candidate.population_a_id,
            "label": candidate.population_a_label,
            "count": candidate.population_a_summary.count,
            "meanValues": candidate.population_a_summary.means,
            "stdevs": candidate.population_a_summary.stdevs,
            "distribution": candidate.population_a_summary.distribution,
        },
        "populationB": {
            "id": candidate.population_b_id,
            "label": candidate.population_b_label,
            "count": candidate.population_b_summary.count,
            "meanValues": candidate.population_b_summary.means,
            "stdevs": candidate.population_b_summary.stdevs,
            "distribution": candidate.population_b_summary.distribution,
        },
        "senses": SENSE_LABELS,
        "valueRange": {"min": 0, "max": 5},
    }


def make_trial(
    *,
    trial_id: str,
    block_id: str,
    part_id: str,
    kind: str,
    chart_type: str,
    task_type: str,
    answer_mode: str,
    prompt: str,
    options: list[str],
    correct_answer: str | list[str],
    stimulus: dict[str, Any],
    difficulty: str | None = None,
    clarity_margin: float | None = None,
    developer_notes: list[str] | None = None,
) -> dict[str, Any]:
    trial = {
        "id": trial_id,
        "blockId": block_id,
        "partId": part_id,
        "kind": kind,
        "chartType": chart_type,
        "taskType": task_type,
        "answerMode": answer_mode,
        "prompt": prompt,
        "options": options,
        "correctAnswer": correct_answer,
        "stimulus": stimulus,
        "footprint": CHART_FOOTPRINTS[chart_type],
    }
    if difficulty is not None:
        trial["difficulty"] = difficulty
    if clarity_margin is not None:
        trial["clarityMargin"] = round(clarity_margin, 2)
    if developer_notes:
        trial["developerNotes"] = developer_notes
    return trial


def pick_unique(items: list[Any], count: int, key_fn) -> list[Any]:
    chosen: list[Any] = []
    seen: set[str] = set()
    for item in items:
        key = key_fn(item)
        if key in seen:
            continue
        chosen.append(item)
        seen.add(key)
        if len(chosen) == count:
            break
    if len(chosen) < count:
        raise ValueError(f"Unable to pick {count} unique items.")
    return chosen


def chart_title(chart_type: str) -> str:
    return {
        "distribution_radar": "Distribution-Aware Radial Profile",
        "histogram_small_multiples": "Histogram Small Multiples",
        "stacked_bar_distribution": "Stacked Bar Distribution",
        "zchart": "Z-Score Radar Chart",
        "dual_histogram": "Dual Histogram Comparison",
    }[chart_type]


def build_pack() -> dict[str, Any]:
    random.seed(RANDOM_SEED)
    users = load_users()
    foods_map = build_food_maps(users)
    group_maps = build_group_maps(users)

    overall_summaries = {
        food: compute_summary(food, ratings)
        for food, ratings in foods_map.items()
        if len(ratings) >= MIN_FOOD_RATINGS
    }
    ranked_summaries = sorted(
        overall_summaries.values(),
        key=lambda summary: (summary.count, summary.food),
        reverse=True,
    )

    block1_candidates = [
        candidate
        for summary in ranked_summaries
        if (candidate := build_tuple_candidate(summary)) is not None
    ]
    block2_candidates = build_profile_candidates(ranked_summaries, mode="dominant", needed=3)
    block3_candidates = build_profile_candidates(ranked_summaries, mode="spatial", needed=3)
    block4_candidates, block5_candidates = build_population_candidates(
        group_maps,
        overall_summaries=overall_summaries,
    )

    block5_significant = [item for item in block5_candidates if item.magnitude_label == "Significant"]
    block5_subtle = [item for item in block5_candidates if item.magnitude_label == "Subtle"]

    block1_selected = pick_unique(block1_candidates, 4, lambda item: item.summary.food)
    block2_selected = pick_unique(block2_candidates, 4, lambda item: item.stimulus_id)
    block3_selected = pick_unique(block3_candidates, 4, lambda item: item.stimulus_id)
    block4_selected = pick_unique(block4_candidates, 4, lambda item: item.stimulus_id)
    block5_significant_selected = pick_unique(
        block5_significant,
        2,
        lambda item: item.stimulus_id,
    )
    block5_subtle_selected = pick_unique(
        block5_subtle,
        2,
        lambda item: item.stimulus_id,
    )

    block1_practice_candidate = block1_selected[0]
    block1_real_candidates = block1_selected[1:3]
    block1_preview_candidate = block1_selected[3]

    block2_practice_candidate = block2_selected[0]
    block2_real_candidates = block2_selected[1:3]
    block2_preview_candidate = block2_selected[3]

    block3_practice_candidate = block3_selected[0]
    block3_real_candidates = block3_selected[1:3]
    block3_preview_candidate = block3_selected[3]

    block4_practice_candidate = block4_selected[0]
    block4_real_candidates = block4_selected[1:3]
    block4_preview_candidate = block4_selected[3]

    block5_practice_candidate = block5_significant_selected[0]
    block5_real_candidates = [block5_subtle_selected[0], block5_significant_selected[1]]
    block5_preview_candidate = block5_subtle_selected[1]

    block1_practice = [
        make_trial(
            trial_id="block1-practice-1",
            block_id="block1",
            part_id="part_a",
            kind="practice",
            chart_type="distribution_radar",
            task_type="distribution_agreement",
            answer_mode="single_choice_tuple",
            prompt="Which combination of taste attributes is most strongly supported by the ratings?",
            options=block1_practice_candidate.options,
            correct_answer=tuple_label(block1_practice_candidate.correct_keys),
            stimulus=single_food_stimulus(block1_practice_candidate.summary, "block1-practice"),
            difficulty=block1_practice_candidate.difficulty,
            clarity_margin=block1_practice_candidate.clarity_margin,
            developer_notes=block1_practice_candidate.notes,
        )
    ]

    block1_real_sequence = [
        (0, "distribution_radar"),
        (1, "histogram_small_multiples"),
        (0, "stacked_bar_distribution"),
        (1, "distribution_radar"),
        (0, "histogram_small_multiples"),
        (1, "stacked_bar_distribution"),
    ]
    block1_real = []
    for index, (candidate_index, chart_type) in enumerate(block1_real_sequence, start=1):
        candidate = block1_real_candidates[candidate_index]
        block1_real.append(
            make_trial(
                trial_id=f"block1-real-{index}",
                block_id="block1",
                part_id="part_a",
                kind="real",
                chart_type=chart_type,
                task_type="distribution_agreement",
                answer_mode="single_choice_tuple",
                prompt="Which combination of taste attributes is most strongly supported by the ratings?",
                options=candidate.options,
                correct_answer=tuple_label(candidate.correct_keys),
                stimulus=single_food_stimulus(candidate.summary, f"block1-real-{candidate.summary.food}"),
                difficulty=candidate.difficulty,
                clarity_margin=candidate.clarity_margin,
                developer_notes=candidate.notes,
            )
        )

    block2_practice = [
        make_trial(
            trial_id="block2-practice-1",
            block_id="block2",
            part_id="part_a",
            kind="practice",
            chart_type="histogram_small_multiples",
            task_type="dominant_profile_similarity",
            answer_mode="multi_select_indices",
            prompt=f"Which of the numbered foods match the target flavor profile: {tuple_label(block2_practice_candidate.target_keys)}?",
            options=[str(food["index"]) for food in multi_food_stimulus(block2_practice_candidate)["foods"]],
            correct_answer=[str(index) for index in block2_practice_candidate.correct_indices],
            stimulus=multi_food_stimulus(block2_practice_candidate),
            difficulty=block2_practice_candidate.difficulty,
            clarity_margin=block2_practice_candidate.clarity_margin,
            developer_notes=block2_practice_candidate.notes,
        )
    ]

    block2_real_sequence = [
        (0, "distribution_radar"),
        (1, "histogram_small_multiples"),
        (0, "stacked_bar_distribution"),
        (1, "distribution_radar"),
        (0, "histogram_small_multiples"),
        (1, "stacked_bar_distribution"),
    ]
    block2_real = []
    for index, (candidate_index, chart_type) in enumerate(block2_real_sequence, start=1):
        candidate = block2_real_candidates[candidate_index]
        stimulus = multi_food_stimulus(candidate)
        block2_real.append(
            make_trial(
                trial_id=f"block2-real-{index}",
                block_id="block2",
                part_id="part_a",
                kind="real",
                chart_type=chart_type,
                task_type="dominant_profile_similarity",
                answer_mode="multi_select_indices",
                prompt=f"Which of the numbered foods match the target flavor profile: {tuple_label(candidate.target_keys)}?",
                options=[str(food["index"]) for food in stimulus["foods"]],
                correct_answer=[str(item) for item in candidate.correct_indices],
                stimulus=stimulus,
                difficulty=candidate.difficulty,
                clarity_margin=candidate.clarity_margin,
                developer_notes=candidate.notes,
            )
        )

    block3_practice = [
        make_trial(
            trial_id="block3-practice-1",
            block_id="block3",
            part_id="part_a",
            kind="practice",
            chart_type="stacked_bar_distribution",
            task_type="spatial_profile_comparison",
            answer_mode="multi_select_indices",
            prompt=f"Which of the numbered foods match the target profile: {' and '.join(SENSE_LABELS[key] for key in block3_practice_candidate.target_keys)}?",
            options=[str(food["index"]) for food in multi_food_stimulus(block3_practice_candidate)["foods"]],
            correct_answer=[str(index) for index in block3_practice_candidate.correct_indices],
            stimulus=multi_food_stimulus(block3_practice_candidate),
            difficulty=block3_practice_candidate.difficulty,
            clarity_margin=block3_practice_candidate.clarity_margin,
            developer_notes=block3_practice_candidate.notes,
        )
    ]

    block3_real = []
    for index, (candidate_index, chart_type) in enumerate(block2_real_sequence, start=1):
        candidate = block3_real_candidates[candidate_index]
        stimulus = multi_food_stimulus(candidate)
        block3_real.append(
            make_trial(
                trial_id=f"block3-real-{index}",
                block_id="block3",
                part_id="part_a",
                kind="real",
                chart_type=chart_type,
                task_type="spatial_profile_comparison",
                answer_mode="multi_select_indices",
                prompt=f"Which of the numbered foods match the target profile: {' and '.join(SENSE_LABELS[key] for key in candidate.target_keys)}?",
                options=[str(food["index"]) for food in stimulus["foods"]],
                correct_answer=[str(item) for item in candidate.correct_indices],
                stimulus=stimulus,
                difficulty=candidate.difficulty,
                clarity_margin=candidate.clarity_margin,
                developer_notes=candidate.notes,
            )
        )

    block4_practice = [
        make_trial(
            trial_id="block4-practice-1",
            block_id="block4",
            part_id="part_b",
            kind="practice",
            chart_type="zchart",
            task_type="distribution_comparison",
            answer_mode="single_choice_tuple",
            prompt="For these two populations, on which taste attributes do they differ?",
            options=block4_practice_candidate.options,
            correct_answer=tuple_label(block4_practice_candidate.correct_keys),
            stimulus=comparison_stimulus(block4_practice_candidate),
            difficulty=block4_practice_candidate.difficulty,
            clarity_margin=block4_practice_candidate.clarity_margin,
            developer_notes=block4_practice_candidate.notes,
        )
    ]

    block4_real_sequence = [
        (0, "zchart"),
        (1, "dual_histogram"),
        (1, "zchart"),
        (0, "dual_histogram"),
    ]
    block4_real = []
    for index, (candidate_index, chart_type) in enumerate(block4_real_sequence, start=1):
        candidate = block4_real_candidates[candidate_index]
        block4_real.append(
            make_trial(
                trial_id=f"block4-real-{index}",
                block_id="block4",
                part_id="part_b",
                kind="real",
                chart_type=chart_type,
                task_type="distribution_comparison",
                answer_mode="single_choice_tuple",
                prompt="For these two populations, on which taste attributes do they differ?",
                options=candidate.options,
                correct_answer=tuple_label(candidate.correct_keys),
                stimulus=comparison_stimulus(candidate),
                difficulty=candidate.difficulty,
                clarity_margin=candidate.clarity_margin,
                developer_notes=candidate.notes,
            )
        )

    block5_practice = [
        make_trial(
            trial_id="block5-practice-1",
            block_id="block5",
            part_id="part_b",
            kind="practice",
            chart_type="dual_histogram",
            task_type="difference_size",
            answer_mode="binary_choice",
            prompt="For these two populations, are their differences significant or subtle?",
            options=["Significant", "Subtle"],
            correct_answer=block5_practice_candidate.magnitude_label or "Subtle",
            stimulus=comparison_stimulus(block5_practice_candidate),
            difficulty=block5_practice_candidate.difficulty,
            clarity_margin=block5_practice_candidate.clarity_margin,
            developer_notes=block5_practice_candidate.notes,
        )
    ]

    block5_real_sequence = [
        (0, "zchart"),
        (1, "dual_histogram"),
        (1, "zchart"),
        (0, "dual_histogram"),
    ]
    block5_real = []
    for index, (candidate_index, chart_type) in enumerate(block5_real_sequence, start=1):
        candidate = block5_real_candidates[candidate_index]
        block5_real.append(
            make_trial(
                trial_id=f"block5-real-{index}",
                block_id="block5",
                part_id="part_b",
                kind="real",
                chart_type=chart_type,
                task_type="difference_size",
                answer_mode="binary_choice",
                prompt="For these two populations, are their differences significant or subtle?",
                options=["Significant", "Subtle"],
                correct_answer=candidate.magnitude_label or "Subtle",
                stimulus=comparison_stimulus(candidate),
                difficulty=candidate.difficulty,
                clarity_margin=candidate.clarity_margin,
                developer_notes=candidate.notes,
            )
        )

    part_a_previews = [
        make_trial(
            trial_id="part-a-preview-radar",
            block_id="block1",
            part_id="part_a",
            kind="preview",
            chart_type="distribution_radar",
            task_type="tutorial_preview",
            answer_mode="none",
            prompt="Preview",
            options=[],
            correct_answer="",
            stimulus=single_food_stimulus(block1_preview_candidate.summary, "part-a-preview-radar"),
        ),
        make_trial(
            trial_id="part-a-preview-hist",
            block_id="block1",
            part_id="part_a",
            kind="preview",
            chart_type="histogram_small_multiples",
            task_type="tutorial_preview",
            answer_mode="none",
            prompt="Preview",
            options=[],
            correct_answer="",
            stimulus=single_food_stimulus(block1_preview_candidate.summary, "part-a-preview-hist"),
        ),
        make_trial(
            trial_id="part-a-preview-stacked",
            block_id="block1",
            part_id="part_a",
            kind="preview",
            chart_type="stacked_bar_distribution",
            task_type="tutorial_preview",
            answer_mode="none",
            prompt="Preview",
            options=[],
            correct_answer="",
            stimulus=single_food_stimulus(block1_preview_candidate.summary, "part-a-preview-stacked"),
        ),
    ]

    part_b_previews = [
        make_trial(
            trial_id="part-b-preview-zchart",
            block_id="block4",
            part_id="part_b",
            kind="preview",
            chart_type="zchart",
            task_type="tutorial_preview",
            answer_mode="none",
            prompt="Preview",
            options=[],
            correct_answer="",
            stimulus=comparison_stimulus(block4_preview_candidate),
        ),
        make_trial(
            trial_id="part-b-preview-dual",
            block_id="block4",
            part_id="part_b",
            kind="preview",
            chart_type="dual_histogram",
            task_type="tutorial_preview",
            answer_mode="none",
            prompt="Preview",
            options=[],
            correct_answer="",
            stimulus=comparison_stimulus(block5_preview_candidate),
        ),
    ]

    blocks = [
        {
            "id": "block1",
            "partId": "part_a",
            "title": "Block 1: Distribution and Agreement",
            "intro": "In this block, you will identify which combinations of taste attributes are most strongly supported by the ratings. Focus on overall support and agreement in the distributions rather than simply looking for the highest mean.",
            "taskInstruction": "Select the one option that best matches the attributes most strongly supported by the shown ratings.",
            "onboarding": [
                {
                    "chartType": "distribution_radar",
                    "title": "Distribution-Aware Radial Profile",
                    "callouts": [
                        "The red outline summarizes the profile, while the shaded radial bands show how ratings are distributed within each taste dimension.",
                    ],
                },
                {
                    "chartType": "histogram_small_multiples",
                    "title": "Histogram Small Multiples",
                    "callouts": [
                        "Each panel shows the full rating distribution for one taste attribute, making support and agreement visible directly.",
                    ],
                },
                {
                    "chartType": "stacked_bar_distribution",
                    "title": "Stacked Bar Distribution",
                    "callouts": [
                        "Each stacked bar shows the share of ratings at each level for a taste attribute, from low to high.",
                    ],
                },
            ],
            "onboardingPreviewTrials": part_a_previews,
            "practiceTrials": block1_practice,
            "realTrials": block1_real,
        },
        {
            "id": "block2",
            "partId": "part_a",
            "title": "Block 2: Dominant Profile Similarity",
            "intro": "In this block, you will compare several numbered foods at once and identify which foods match a target flavor profile.",
            "taskInstruction": "Select **exactly 2** numbered foods that match the target profile. Use the chart only, and submit once your two selections are final.",
            "onboarding": [],
            "practiceTrials": block2_practice,
            "realTrials": block2_real,
        },
        {
            "id": "block3",
            "partId": "part_a",
            "title": "Block 3: Spatial Profile Comparison",
            "intro": "In this block, you will identify foods that match a target profile defined by attributes in different regions of the chart space, such as one attribute on one side and another on the opposite side.",
            "taskInstruction": "Select **exactly 2** numbered foods that match the target spatial profile.",
            "onboarding": [],
            "practiceTrials": block3_practice,
            "realTrials": block3_real,
            "subjectiveSection": {
                "id": "part-a-ratings",
                "title": "Part A and B Chart Evaluation",
                "instructions": "Please rate the charts you used in Blocks 1 to 3.",
                "charts": [
                    {"chartType": "distribution_radar", "title": chart_title("distribution_radar")},
                    {
                        "chartType": "histogram_small_multiples",
                        "title": chart_title("histogram_small_multiples"),
                    },
                    {
                        "chartType": "stacked_bar_distribution",
                        "title": chart_title("stacked_bar_distribution"),
                    },
                ],
                "questions": [
                    {
                        "id": "easy_identify",
                        "label": "This chart made the requested information easy to identify.",
                    },
                    {
                        "id": "confidence",
                        "label": "I felt confident in my answers when using this chart.",
                    },
                    {
                        "id": "pattern_clarity",
                        "label": "This chart clearly conveyed the relevant flavor patterns or differences.",
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
            "id": "block4",
            "partId": "part_b",
            "title": "Block 4: Distribution Comparison",
            "intro": "In this block, you will compare two populations and identify the taste attributes on which their distributions differ most clearly.",
            "taskInstruction": "Select the one option that best describes where the two populations differ.",
            "onboarding": [
                {
                    "chartType": "zchart",
                    "title": "Z-Score Radar Chart",
                    "callouts": [
                        "The shape summarizes which attributes are above or below the reference population, and larger radial displacement indicates larger differences.",
                    ],
                },
                {
                    "chartType": "dual_histogram",
                    "title": "Dual Histogram Comparison",
                    "callouts": [
                        "Each attribute shows two mirrored distributions, letting you compare where each population is concentrated at each rating level.",
                    ],
                },
            ],
            "onboardingPreviewTrials": part_b_previews,
            "practiceTrials": block4_practice,
            "realTrials": block4_real,
        },
        {
            "id": "block5",
            "partId": "part_b",
            "title": "Block 5: Distribution Difference Size",
            "intro": "In this block, you will judge whether the differences between two populations are substantial or relatively subtle.",
            "taskInstruction": "Choose whether the shown differences are significant or subtle.",
            "onboarding": [],
            "practiceTrials": block5_practice,
            "realTrials": block5_real,
            "subjectiveSection": {
                "id": "part-b-ratings",
                "title": "Part C Chart Evaluation",
                "instructions": "Please rate the charts you used in Blocks 4 and 5.",
                "charts": [
                    {"chartType": "zchart", "title": chart_title("zchart")},
                    {"chartType": "dual_histogram", "title": chart_title("dual_histogram")},
                ],
                "questions": [
                    {
                        "id": "easy_identify",
                        "label": "This chart made the requested information easy to identify.",
                    },
                    {
                        "id": "confidence",
                        "label": "I felt confident in my answers when using this chart.",
                    },
                    {
                        "id": "pattern_clarity",
                        "label": "This chart clearly conveyed the relevant flavor patterns or differences.",
                    },
                    {
                        "id": "visual_clutter",
                        "label": "This chart felt visually cluttered.",
                    },
                ],
                "scaleOptions": LIKERT_OPTIONS,
            },
        },
    ]

    pack = {
        "title": "Flavor Chart Interpretation Study",
        "responseEndpoint": "",
        "consentText": [
            "**You are invited to participate in a research study on chart interpretation.**",
            "This study evaluates how different chart designs support interpretation of flavor-related data.",
            "You will answer questions about rating distributions, flavor profiles, and population differences.",
            "**Your responses and response times will be recorded.**",
            "**This study evaluates chart readability and task support, not personal ability.**",
            "**Participation is voluntary and you may stop at any time.**",
        ],
        "introText": [
            "You will see several chart designs that summarize flavor ratings for foods or compare populations of raters.",
            "Some questions ask you to identify which taste attributes are strongly supported by ratings, while others ask you to find foods matching a profile or compare differences between populations.",
            "The study is organized into tutorials, practice trials, main study trials, and short chart rating questions.",
            "**Please answer based only on the information visible in each chart.**",
            "**Work as accurately and quickly as you can.**",
        ],
        "backgroundQuestions": [
            {
                "id": "chart_familiarity",
                "label": "How familiar are you with charts such as histograms, stacked bars, and radar charts?",
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
        "blocks": blocks,
        "finalPreferenceQuestions": [
            {
                "id": "preferred_agreement",
                "label": "Which chart did you prefer for understanding flavor agreement?",
                "options": [
                    chart_title("distribution_radar"),
                    chart_title("histogram_small_multiples"),
                    chart_title("stacked_bar_distribution"),
                ],
            },
            {
                "id": "preferred_profile",
                "label": "Which chart did you prefer for identifying matching profiles?",
                "options": [
                    chart_title("distribution_radar"),
                    chart_title("histogram_small_multiples"),
                    chart_title("stacked_bar_distribution"),
                ],
            },
            {
                "id": "preferred_population_difference",
                "label": "Which chart did you prefer for comparing population differences?",
                "options": [
                    chart_title("zchart"),
                    chart_title("dual_histogram"),
                ],
            },
        ],
        "finalCommentPrompt": "Additional comments (optional)",
        "metadata": {
            "chartFootprints": CHART_FOOTPRINTS,
            "realTrialCount": sum(len(block["realTrials"]) for block in blocks),
            "practiceTrialCount": sum(len(block["practiceTrials"]) for block in blocks),
            "blockRealTrialCounts": {
                block["id"]: len(block["realTrials"]) for block in blocks
            },
        },
    }
    return pack


def print_developer_summary(pack: dict[str, Any]) -> None:
    print("Selected trial summary:")
    for block in pack["blocks"]:
        for trial in block["practiceTrials"] + block["realTrials"]:
            stimulus = trial["stimulus"]
            correct_answer = trial["correctAnswer"]
            if isinstance(correct_answer, list):
                correct_display = ", ".join(correct_answer)
            else:
                correct_display = correct_answer
            notes = "; ".join(trial.get("developerNotes", []))
            print(
                " - "
                f"{block['id']} | chart={trial['chartType']} | task={trial['taskType']} | "
                f"foods={', '.join(stimulus.get('foodNames', []))} | "
                f"correct={correct_display} | margin={trial.get('clarityMargin', 'n/a')} | "
                f"notes={notes}"
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
