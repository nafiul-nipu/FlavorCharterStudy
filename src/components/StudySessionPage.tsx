import { Fragment, useEffect, useMemo, useState } from "react";
import GroupedBarChart from "./GroupedBarChart";
import OutlierRadarChart from "./OutlierRadarChart";
import OverlaidRadarChart from "./OverlaidRadarChart";
import ViolinPlot from "./ViolinPlot";
import ZGlyph from "./ZGlyph";
import {
  clearSession,
  createEmptySession,
  loadSession,
  saveSession,
  type SavedSession,
} from "../lib/storage";
import { submitStudySession } from "../lib/sync";
import type {
  ChartType,
  ComparisonStimulus,
  OutlierStimulus,
  StudyBlock,
  StudyPack,
  SubjectiveSection,
  Trial,
} from "../lib/types";

const MIN_VIEW_MS = 1500;

type Step =
  | { type: "consent" }
  | { type: "background" }
  | { type: "intro" }
  | { type: "blockIntro"; block: StudyBlock }
  | { type: "onboarding"; block: StudyBlock; screenIndex: number }
  | { type: "practiceIntro"; block: StudyBlock }
  | { type: "trial"; block: StudyBlock; trial: Trial }
  | { type: "realIntro"; block: StudyBlock }
  | { type: "subjective"; block: StudyBlock }
  | { type: "finalSurvey" }
  | { type: "complete" };

type SubmissionState = {
  status: "idle" | "submitting" | "submitted" | "error";
  message: string;
};

type ExtendedSavedSession = SavedSession & {
  sessionStartedAt?: string;
  subjectiveAnswers?: Record<string, Record<string, Record<string, string>>>;
  finalPreferences?: Record<string, string>;
  finalComment?: string;
};

export default function StudySessionPage() {
  const [pack, setPack] = useState<StudyPack | null>(null);
  const [error, setError] = useState("");
  const [session, setSession] = useState<ExtendedSavedSession>(() => {
    const now = new Date().toISOString();
    if (typeof window === "undefined") {
      return { ...createEmptySession(), sessionStartedAt: now };
    }
    const loaded = loadSession() as ExtendedSavedSession | null;
    return loaded ?? { ...createEmptySession(), sessionStartedAt: now };
  });
  const [backgroundDraft, setBackgroundDraft] = useState<Record<string, string>>(
    session.backgroundAnswers,
  );
  const [activeAnswer, setActiveAnswer] = useState("");
  const [trialStartedAt, setTrialStartedAt] = useState(Date.now());
  const [minViewElapsed, setMinViewElapsed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({
    status: "idle",
    message: "",
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("./study-data/study-pack.json");
        if (!response.ok) {
          throw new Error(`Unable to load study pack (${response.status})`);
        }
        const data = (await response.json()) as StudyPack;
        if (!cancelled) setPack(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load study pack");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  const steps = useMemo<Step[]>(() => {
    if (!pack) return [];
    const items: Step[] = [{ type: "consent" }, { type: "background" }, { type: "intro" }];
    for (const block of pack.blocks) {
      items.push({ type: "blockIntro", block });
      block.onboarding.forEach((_, screenIndex) => {
        items.push({ type: "onboarding", block, screenIndex });
      });
      items.push({ type: "practiceIntro", block });
      for (const trial of block.practiceTrials) {
        items.push({ type: "trial", block, trial });
      }
      items.push({ type: "realIntro", block });
      for (const trial of block.realTrials) {
        items.push({ type: "trial", block, trial });
      }
      items.push({ type: "subjective", block });
    }
    items.push({ type: "finalSurvey" }, { type: "complete" });
    return items;
  }, [pack]);

  const currentStep = steps[session.currentStep];

  useEffect(() => {
    if (currentStep?.type === "trial") {
      setTrialStartedAt(Date.now());
      setMinViewElapsed(false);
      setActiveAnswer("");
      setFeedback("");
      const timer = window.setTimeout(() => {
        setMinViewElapsed(true);
      }, MIN_VIEW_MS);
      return () => window.clearTimeout(timer);
    }
  }, [currentStep]);

  function goToNextStep() {
    setSession((prev) => ({
      ...prev,
      currentStep: Math.min(prev.currentStep + 1, Math.max(steps.length - 1, 0)),
    }));
  }

  function goToPreviousStep() {
    setSession((prev) => ({
      ...prev,
      currentStep: Math.max(prev.currentStep - 1, 0),
    }));
  }

  function acceptConsent() {
    setSession((prev) => ({
      ...prev,
      consentAccepted: true,
      consentAcceptedAt: prev.consentAcceptedAt ?? new Date().toISOString(),
      sessionStartedAt: prev.sessionStartedAt ?? new Date().toISOString(),
    }));
    goToNextStep();
  }

  function saveBackground() {
    setSession((prev) => ({
      ...prev,
      backgroundAnswers: backgroundDraft,
    }));
    goToNextStep();
  }

  function updateSubjectiveAnswer(
    blockId: string,
    chartType: string,
    questionId: string,
    value: string,
  ) {
    setSession((prev) => ({
      ...prev,
      subjectiveAnswers: {
        ...(prev.subjectiveAnswers ?? {}),
        [blockId]: {
          ...((prev.subjectiveAnswers ?? {})[blockId] ?? {}),
          [chartType]: {
            ...(((prev.subjectiveAnswers ?? {})[blockId] ?? {})[chartType] ?? {}),
            [questionId]: value,
          },
        },
      },
    }));
  }

  function updateFinalPreference(questionId: string, value: string) {
    setSession((prev) => ({
      ...prev,
      finalPreferences: {
        ...(prev.finalPreferences ?? {}),
        [questionId]: value,
      },
    }));
  }

  function submitTrial(trial: Trial) {
    if (!activeAnswer || !minViewElapsed) return;
    const now = Date.now();
    const stimulus = trial.stimulus as OutlierStimulus | ComparisonStimulus;
    const sessionStartedAtMs = session.sessionStartedAt
      ? new Date(session.sessionStartedAt).getTime()
      : now;
    const responseKind: "practice" | "real" =
      trial.kind === "practice" ? "practice" : "real";
    const nextResponse = {
      participantId: session.participantId,
      trialId: trial.id,
      blockId: trial.blockId,
      partId: trial.partId,
      chartType: trial.chartType,
      taskType: trial.taskType,
      promptType: trial.taskType,
      foodName: stimulus.foodName,
      subgroupLabel:
        "subgroupLabel" in stimulus ? stimulus.subgroupLabel : undefined,
      correctAnswer: trial.correctAnswer,
      answer: activeAnswer,
      isCorrect: activeAnswer === trial.correctAnswer,
      responseTimeMs: now - trialStartedAt,
      difficulty: trial.difficulty,
      trialOrderIndex: getTrialOrderIndex(currentStep, trial),
      kind: responseKind,
      answeredAt: new Date().toISOString(),
      timeSinceSessionStartMs: now - sessionStartedAtMs,
    };

    setSession((prev) => ({
      ...prev,
      trialResponses: [...prev.trialResponses, nextResponse],
    }));

    if (trial.kind === "practice") {
      setFeedback(activeAnswer === trial.correctAnswer ? "Correct" : "Incorrect");
      window.setTimeout(() => {
        setFeedback("");
        goToNextStep();
      }, 900);
      return;
    }

    goToNextStep();
  }

  async function submitAllResponses() {
    if (!pack) return;
    setSubmission({ status: "submitting", message: "Submitting responses..." });
    const result = await submitStudySession(pack, session);
    if (result.ok) {
      setSubmission({ status: "submitted", message: result.message });
      setSession((prev) => ({
        ...prev,
        submittedAt: new Date().toISOString(),
      }));
      return;
    }
    setSubmission({ status: "error", message: result.message });
  }

  if (error) {
    return (
      <main className="shell">
        <section className="card">
          <p className="eyebrow">Study Load Error</p>
          <h1>Unable to start the study.</h1>
          <p className="muted">{error}</p>
        </section>
      </main>
    );
  }

  if (!pack || !currentStep) {
    return (
      <main className="shell">
        <section className="card">
          <p className="eyebrow">Loading</p>
          <h1>Preparing the study session...</h1>
          <p className="muted">Loading the finalized study design and trial pack.</p>
        </section>
      </main>
    );
  }

  const progressSteps = Math.max(1, steps.length - 1);
  const progressPercent = Math.round((session.currentStep / progressSteps) * 100);
  const canSubmit = !!activeAnswer && minViewElapsed;

  return (
    <main className="shell">
      <section className="study-frame">
        <header className="study-header">
          <div>
            <p className="eyebrow">Standalone Study</p>
            <h1>{pack.title}</h1>
          </div>
          <div className="progress-panel">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <p className="muted small">
              Participant: <code>{session.participantId.slice(0, 8)}</code> | Step{" "}
              {session.currentStep + 1} / {steps.length}
            </p>
          </div>
        </header>

        {currentStep.type === "consent" ? (
          <article className="card">
            <h2>Consent and study overview</h2>
            {pack.consentText.map((line) => (
              <FormattedParagraph key={line} text={line} className="muted" />
            ))}
            <button className="primary-button" onClick={acceptConsent}>
              I agree and want to continue
            </button>
          </article>
        ) : null}

        {currentStep.type === "background" ? (
          <article className="card">
            <h2>Background questions</h2>
            <div className="question-grid">
              {pack.backgroundQuestions.map((question) => (
                <fieldset key={question.id} className="question-group">
                  <legend>{question.label}</legend>
                  {question.options.map((option) => (
                    <label key={option} className="option-row">
                      <input
                        type="radio"
                        name={question.id}
                        checked={backgroundDraft[question.id] === option}
                        onChange={() =>
                          setBackgroundDraft((prev) => ({
                            ...prev,
                            [question.id]: option,
                          }))
                        }
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <button
              className="primary-button"
              onClick={saveBackground}
              disabled={pack.backgroundQuestions.some((question) => !backgroundDraft[question.id])}
            >
              Save and continue
            </button>
          </article>
        ) : null}

        {currentStep.type === "intro" ? (
          <article className="card">
            <h2>Study instructions</h2>
            {pack.introText.map((line) => (
              <FormattedParagraph key={line} text={line} className="muted" />
            ))}
            <button className="primary-button" onClick={goToNextStep}>
              Start Tutorial
            </button>
          </article>
        ) : null}

        {currentStep.type === "blockIntro" ? (
          <article className="card">
            <p className="eyebrow">{currentStep.block.partId === "part1" ? "Part 1" : "Part 2"}</p>
            <h2>{currentStep.block.title}</h2>
            <p className="muted">{currentStep.block.intro}</p>
            <p className="muted">
              You will first see a short tutorial for the charts in this part.
            </p>
            <button className="primary-button" onClick={goToNextStep}>
              Start Tutorial
            </button>
          </article>
        ) : null}

        {currentStep.type === "onboarding" ? (
          <OnboardingScreen
            block={currentStep.block}
            screenIndex={currentStep.screenIndex}
            previewTrial={onboardingPreviewForStep(currentStep.block, currentStep.screenIndex)}
            onBack={goToPreviousStep}
            onNext={goToNextStep}
            onSkip={() => skipOnboarding(steps, currentStep, setSession)}
          />
        ) : null}

        {currentStep.type === "practiceIntro" ? (
          <article className="card">
            <p className="eyebrow">Transition</p>
            <h2>{currentStep.block.title}</h2>
            <p className="muted">You will now begin the practice examples for this part.</p>
            <p className="muted">You will see one example for each chart used in this section.</p>
            <button className="primary-button" onClick={goToNextStep}>
              Start Practice
            </button>
          </article>
        ) : null}

        {currentStep.type === "realIntro" ? (
          <article className="card">
            <p className="eyebrow">Transition</p>
            <h2>{currentStep.block.title}</h2>
            <p className="muted">You have finished the practice examples.</p>
            <p className="muted">The next screens are the real study questions for this part.</p>
            <button className="primary-button" onClick={goToNextStep}>
              Start Real Questions
            </button>
          </article>
        ) : null}

        {currentStep.type === "trial" ? (
          <article className="card trial-layout">
            <div className="trial-meta">
              <div>
                <p className="eyebrow">
                  {currentStep.trial.kind === "practice" ? "Practice Trial" : "Main Trial"}
                </p>
                <h2>{`${currentStep.block.title} (${chartDisplayName(currentStep.trial.chartType)})`}</h2>
                <p className="muted">{currentStep.block.taskInstruction}</p>
                <p className="trial-question">
                  <strong>{currentStep.trial.prompt}</strong>
                </p>
              </div>
            </div>

            <div className="answer-panel">
              <h3>Select one answer</h3>
              <div className="question-grid">
                {currentStep.trial.options.map((option) => (
                  <label key={option} className="option-row">
                    <input
                      type="radio"
                      name={currentStep.trial.id}
                      checked={activeAnswer === option}
                      onChange={() => setActiveAnswer(option)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>

              <button
                className="primary-button"
                onClick={() => submitTrial(currentStep.trial)}
                disabled={!canSubmit}
              >
                Submit answer
              </button>

              {feedback ? (
                <p className={feedback === "Correct" ? "success-text" : "error-text"}>
                  {feedback}
                </p>
              ) : null}
            </div>

            <div className="chart-panel">
              <ChartRenderer trial={currentStep.trial} />
            </div>
          </article>
        ) : null}

        {currentStep.type === "subjective" ? (
          <article className="card">
            <h2>{currentStep.block.subjectiveSection.title}</h2>
            <p className="muted">{currentStep.block.subjectiveSection.instructions}</p>
            <SubjectiveMatrix
              section={currentStep.block.subjectiveSection}
              values={(session.subjectiveAnswers ?? {})[currentStep.block.id] ?? {}}
              onChange={(chartType, questionId, value) =>
                updateSubjectiveAnswer(currentStep.block.id, chartType, questionId, value)
              }
            />
            <button
              className="primary-button"
              onClick={goToNextStep}
              disabled={!isSubjectiveSectionComplete(currentStep.block.subjectiveSection, session, currentStep.block.id)}
            >
              Continue
            </button>
          </article>
        ) : null}

        {currentStep.type === "finalSurvey" ? (
          <article className="card">
            <h2>Final questions</h2>
            <div className="question-grid">
              {pack.finalPreferenceQuestions.map((question) => (
                <fieldset key={question.id} className="question-group">
                  <legend>{question.label}</legend>
                  {question.options.map((option) => (
                    <label key={option} className="option-row">
                      <input
                        type="radio"
                        name={question.id}
                        checked={(session.finalPreferences ?? {})[question.id] === option}
                        onChange={() => updateFinalPreference(question.id, option)}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <label className="question-group" style={{ display: "grid", gap: 8 }}>
              <span>{pack.finalCommentPrompt}</span>
              <textarea
                rows={4}
                value={session.finalComment ?? ""}
                onChange={(event) =>
                  setSession((prev) => ({
                    ...prev,
                    finalComment: event.target.value,
                  }))
                }
              />
            </label>
            <button
              className="primary-button"
              onClick={goToNextStep}
              disabled={pack.finalPreferenceQuestions.some(
                (question) => !(session.finalPreferences ?? {})[question.id],
              )}
            >
              Review study summary
            </button>
          </article>
        ) : null}

        {currentStep.type === "complete" ? (
          <article className="card">
            <h2>Study complete</h2>
            <p className="muted">
              Thank you for completing the study. Your responses, response times,
              background answers, chart ratings, and final preferences are now stored
              in this session.
            </p>
            <div className="summary-strip">
              <span>Main trials answered: {session.trialResponses.filter((item) => item.kind === "real").length}</span>
              <span>Accuracy: {accuracyLabel(session)}</span>
            </div>
            <div className="button-row">
              <button
                className="primary-button"
                onClick={() => void submitAllResponses()}
                disabled={submission.status === "submitting"}
              >
                {submission.status === "submitting" ? "Submitting..." : "Submit responses"}
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  clearSession();
                  setSession({ ...createEmptySession(), sessionStartedAt: new Date().toISOString() });
                  setBackgroundDraft({});
                  setSubmission({ status: "idle", message: "" });
                }}
              >
                Reset local session
              </button>
            </div>
            {submission.message ? (
              <p className={submission.status === "submitted" ? "success-text" : "error-text"}>
                {submission.message}
              </p>
            ) : null}
          </article>
        ) : null}
      </section>
    </main>
  );
}

function FormattedParagraph({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const parts = text.split(/(\*\*.*?\*\*)/g).filter(Boolean);
  return (
    <p className={className}>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={`${part}-${index}`}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

function OnboardingScreen({
  block,
  screenIndex,
  previewTrial,
  onBack,
  onNext,
  onSkip,
}: {
  block: StudyBlock;
  screenIndex: number;
  previewTrial?: Trial;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const section = block.onboarding[screenIndex];
  const isFirst = screenIndex === 0;
  const isLast = screenIndex === block.onboarding.length - 1;

  return (
    <article className="card onboarding-card">
      <div className="onboarding-stage">
        <div className="onboarding-copy">
          <p className="eyebrow">Onboarding</p>
          <h2>{block.title}</h2>
          <p className="muted small">
            Step {screenIndex + 1} / {block.onboarding.length}
          </p>
          <h3>{section.title}</h3>
          <p className="muted onboarding-line">{section.callouts.join(" ")}</p>
          <div className="onboarding-legend">
            {chartLegendItems(section.chartType).map((item) => (
              <div key={`${section.chartType}-${item.label}`} className="onboarding-legend-item">
                <span aria-hidden="true" style={legendSwatchStyle(item)} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="onboarding-notes">
            {onboardingNotes(section.chartType).map((note) => (
              <div key={`${section.chartType}-${note.title}`} className="onboarding-note-card">
                <div className="onboarding-note-head">
                  <span
                    className="onboarding-note-dot"
                    style={{ background: note.color }}
                    aria-hidden="true"
                  />
                  <strong>{note.title}</strong>
                </div>
                <p className="muted small">{note.body}</p>
              </div>
            ))}
          </div>
          <div className="button-row onboarding-actions">
            <button className="secondary-button" onClick={onSkip}>
              Skip
            </button>
            <button
              className="secondary-button"
              onClick={onBack}
              disabled={isFirst}
            >
              Back
            </button>
            <button className="primary-button" onClick={onNext}>
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
        <div className="chart-panel onboarding-preview-panel">
          {previewTrial ? <ChartRenderer trial={previewTrial} compact="onboarding" /> : null}
        </div>
      </div>
    </article>
  );
}

function SubjectiveMatrix({
  section,
  values,
  onChange,
}: {
  section: SubjectiveSection;
  values: Record<string, Record<string, string>>;
  onChange: (chartType: string, questionId: string, value: string) => void;
}) {
  return (
    <div className="matrix-shell">
      <div
        className="matrix-grid"
        style={{ gridTemplateColumns: `minmax(260px, 1.4fr) repeat(${section.charts.length}, minmax(220px, 1fr))` }}
      >
        <div className="matrix-head">Question</div>
        {section.charts.map((chart) => (
          <div key={chart.chartType} className="matrix-head matrix-chart-head">
            <div className="matrix-preview-card">
              <div className="matrix-preview-title">{chart.title}</div>
              <SubjectiveChartPreview chartType={chart.chartType} />
            </div>
          </div>
        ))}

        {section.questions.map((question) => (
          <Fragment key={question.id}>
            <div key={`${question.id}-label`} className="matrix-label">
              {question.label}
            </div>
            {section.charts.map((chart) => (
              <div key={`${question.id}-${chart.chartType}`} className="matrix-cell">
                <select
                  className="likert-select"
                  value={values[chart.chartType]?.[question.id] ?? ""}
                  onChange={(event) => onChange(chart.chartType, question.id, event.target.value)}
                >
                  <option value="">Rate</option>
                  {section.scaleOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
      <p className="muted small">Scale: 1 = strongly disagree, 5 = strongly agree.</p>
    </div>
  );
}

function onboardingPreviewForStep(block: StudyBlock, screenIndex: number) {
  const chartType = block.onboarding[screenIndex]?.chartType;
  return (block.onboardingPreviewTrials ?? []).find((trial) => trial.chartType === chartType);
}

function skipOnboarding(
  steps: Step[],
  currentStep: Extract<Step, { type: "onboarding" }>,
  setSession: (value: (prev: ExtendedSavedSession) => ExtendedSavedSession) => void,
) {
  const currentIndex = steps.findIndex(
    (step) =>
      step.type === "onboarding" &&
      step.block.id === currentStep.block.id &&
      step.screenIndex === currentStep.screenIndex,
  );
  const nextIndex = steps.findIndex(
    (step, index) =>
      index > currentIndex &&
      !(
        step.type === "onboarding" &&
        step.block.id === currentStep.block.id
      ),
  );
  setSession((prev) => ({
    ...prev,
    currentStep: nextIndex >= 0 ? nextIndex : prev.currentStep,
  }));
}

function accuracyLabel(session: SavedSession) {
  const real = session.trialResponses.filter((item) => item.kind === "real");
  if (!real.length) return "n/a";
  const correct = real.filter((item) => item.isCorrect).length;
  return `${correct}/${real.length}`;
}

function getTrialOrderIndex(step: Step, trial: Trial) {
  if (step.type !== "trial") return 0;
  const ordered = [...step.block.practiceTrials, ...step.block.realTrials];
  return Math.max(0, ordered.findIndex((item) => item.id === trial.id));
}

function isSubjectiveSectionComplete(
  section: SubjectiveSection,
  session: ExtendedSavedSession,
  blockId: string,
) {
  const blockAnswers = (session.subjectiveAnswers ?? {})[blockId] ?? {};
  return section.charts.every((chart) =>
    section.questions.every((question) => blockAnswers[chart.chartType]?.[question.id]),
  );
}

function chartDisplayName(chartType: ChartType) {
  switch (chartType) {
    case "grouped_bar":
      return "Grouped Bar Chart";
    case "violin_plot":
      return "Violin Plot";
    case "outlier_radar":
      return "Distribution-Aware Radial Profile";
    case "overlaid_radar":
      return "Overlaid Radar Chart";
    case "zglyph":
      return "Z-Score Radar Chart";
    default:
      return chartType;
  }
}

function chartLegendItems(chartType: ChartType) {
  switch (chartType) {
    case "grouped_bar":
      return [{ label: "Mean rating", kind: "fill" as const, color: "#f59e0b" }];
    case "violin_plot":
      return [
        { label: "Rating density", kind: "fill" as const, color: "rgba(14, 165, 233, 0.28)" },
        { label: "Distribution outline", kind: "line" as const, color: "#0284c7" },
      ];
    case "outlier_radar":
      return [
        { label: "Mean outline", kind: "line" as const, color: "#ff0000" },
        { label: "Distribution bands", kind: "fill" as const, color: "#ffa500" },
      ];
    case "overlaid_radar":
      return [
        { label: "Baseline", kind: "fill" as const, color: "#94a3b8" },
        { label: "Subgroup", kind: "fill" as const, color: "#fb923c" },
      ];
    case "zglyph":
      return [
        { label: "Above baseline", kind: "dot" as const, color: "#d9534f" },
        { label: "Below baseline", kind: "dot" as const, color: "#0275d8" },
      ];
    default:
      return [];
  }
}

function onboardingNotes(chartType: ChartType) {
  switch (chartType) {
    case "grouped_bar":
      return [
        {
          title: "Bars",
          color: "#f59e0b",
          body: "Each bar represents one taste dimension, and bar height shows the mean rating for that attribute.",
        },
        {
          title: "How to read it",
          color: "#9a3412",
          body: "To answer mean-related questions, compare the bar heights and identify the tallest bar.",
        },
      ];
    case "violin_plot":
      return [
        {
          title: "Width",
          color: "#0ea5e9",
          body: "Wider regions indicate that more ratings occurred at that level.",
        },
        {
          title: "Variability",
          color: "#0284c7",
          body: "Greater vertical spread indicates ratings are distributed across a wider range and therefore vary more.",
        },
      ];
    case "outlier_radar":
      return [
        {
          title: "Mean",
          color: "#ff0000",
          body: "The red outline shows the mean profile across taste dimensions.",
        },
        {
          title: "Distribution",
          color: "#ffa500",
          body: "The orange bands show how ratings are distributed across levels for each attribute.",
        },
        {
          title: "How to read it",
          color: "#9a3412",
          body: "Use the outline for mean comparisons and the band spread to understand variability.",
        },
      ];
    case "overlaid_radar":
      return [
        {
          title: "Profiles",
          color: "#94a3b8",
          body: "The two profiles represent the baseline and the subgroup on the same set of taste axes.",
        },
        {
          title: "Differences",
          color: "#fb923c",
          body: "Where the two shapes separate more, the subgroup differs more strongly from the baseline.",
        },
      ];
    case "zglyph":
      return [
        {
          title: "Direction",
          color: "#d9534f",
          body: "Direction indicates whether the subgroup is above or below the baseline for an attribute.",
        },
        {
          title: "Magnitude",
          color: "#0275d8",
          body: "Larger displacement indicates a larger subgroup-baseline difference.",
        },
      ];
    default:
      return [];
  }
}

function legendSwatchStyle(item: {
  kind: "fill" | "line" | "dot";
  color: string;
}) {
  if (item.kind === "line") {
    return {
      width: "16px",
      height: "0",
      borderTop: `3px solid ${item.color}`,
      display: "inline-block",
    };
  }
  if (item.kind === "dot") {
    return {
      width: "10px",
      height: "10px",
      borderRadius: "999px",
      background: item.color,
      display: "inline-block",
    };
  }
  return {
    width: "12px",
    height: "12px",
    borderRadius: "4px",
    background: item.color,
    display: "inline-block",
    border: "1px solid rgba(15, 23, 42, 0.12)",
  };
}

function ChartLegend({
  chartType,
  compact = false,
}: {
  chartType: ChartType;
  compact?: false | "onboarding" | "mini";
}) {
  const items = chartLegendItems(chartType);
  return (
    <div
      className="chart-legend"
      style={{
        gap: compact ? "0.3rem 0.5rem" : "0.4rem 0.75rem",
        marginBottom: compact ? "0.4rem" : "0.5rem",
      }}
    >
      {items.map((item) => (
        <span key={`${chartType}-${item.label}`} className="chart-legend-item">
          <span aria-hidden="true" style={legendSwatchStyle(item)} />
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function SubjectiveChartPreview({ chartType }: { chartType: ChartType }) {
  const senses = {
    Sweetness: "Sweet",
    Sourness: "Sour",
    Saltiness: "Salty",
    Bitterness: "Bitter",
    Savoriness: "Savory",
    Fatness: "Fatty",
    Astringency: "Astringent",
    Aromaticity: "Aromatic",
    Texture: "Texture",
    Piquancy: "Piquant",
  };
  const distribution = Object.fromEntries(
    Object.keys(senses).map((key, index) => [
      key,
      {
        "0": { count: index % 2, percent: 5 },
        "1": { count: 1 + (index % 3), percent: 12 },
        "2": { count: 3 + (index % 2), percent: 18 },
        "3": { count: 4 + ((index + 1) % 3), percent: 24 },
        "4": { count: 2 + (index % 4), percent: 20 },
        "5": { count: 1 + (index % 2), percent: 10 },
      },
    ]),
  );
  const outliers = Object.fromEntries(
    Object.keys(senses).map((key, index) => [key, index % 4 === 0 ? [4] : []]),
  );
  const meanValues = {
    Sweetness: 2.5,
    Sourness: 1.8,
    Saltiness: 3.7,
    Bitterness: 2.2,
    Savoriness: 3.1,
    Fatness: 2.7,
    Astringency: 1.4,
    Aromaticity: 2.9,
    Texture: 2.3,
    Piquancy: 1.6,
  };
  const baselineMean = {
    Sweetness: 2.2,
    Sourness: 2.8,
    Saltiness: 1.4,
    Bitterness: 1.8,
    Savoriness: 2.3,
    Fatness: 2.0,
    Astringency: 1.4,
    Aromaticity: 2.4,
    Texture: 2.1,
    Piquancy: 1.3,
  };
  const compareMean = {
    Sweetness: 2.7,
    Sourness: 2.1,
    Saltiness: 1.9,
    Bitterness: 2.5,
    Savoriness: 2.9,
    Fatness: 2.2,
    Astringency: 1.8,
    Aromaticity: 3.0,
    Texture: 1.9,
    Piquancy: 1.6,
  };
  const baselineStDev = {
    Sweetness: 0.6,
    Sourness: 0.7,
    Saltiness: 0.5,
    Bitterness: 0.8,
    Savoriness: 0.7,
    Fatness: 0.6,
    Astringency: 0.5,
    Aromaticity: 0.8,
    Texture: 0.6,
    Piquancy: 0.5,
  };

  const trial: Trial =
    chartType === "overlaid_radar" || chartType === "zglyph"
      ? {
          id: `subjective-${chartType}`,
          blockId: "preview",
          partId: "preview",
          kind: "preview",
          chartType,
          taskType: "tutorial_preview",
          prompt: "",
          options: [],
          correctAnswer: "",
          stimulus: {
            foodName: "Example",
            count: 32,
            senses,
            valueRange: { min: 0, max: 5 },
            baselineMean,
            baselineStDev,
            compareMean,
            subgroupLabel: "Example",
          },
        }
      : {
          id: `subjective-${chartType}`,
          blockId: "preview",
          partId: "preview",
          kind: "preview",
          chartType,
          taskType: "tutorial_preview",
          prompt: "",
          options: [],
          correctAnswer: "",
          stimulus: {
            foodName: "Example",
            count: 42,
            senses,
            valueRange: { min: 0, max: 5 },
            meanValues,
            stdevs: meanValues,
            distribution,
            outliers,
          },
        };

  return <ChartRenderer trial={trial} compact="mini" hideCaption hideLegend />;
}

function ChartRenderer({
  trial,
  compact = false,
  hideCaption = false,
  hideLegend = false,
}: {
  trial: Trial;
  compact?: false | "onboarding" | "mini";
  hideCaption?: boolean;
  hideLegend?: boolean;
}) {
  if (trial.chartType === "grouped_bar") {
    const stimulus = trial.stimulus as OutlierStimulus;
    return (
      <div className="chart-figure">
        {hideCaption ? null : <p className="chart-caption">{stimulus.foodName}</p>}
        {hideLegend ? null : <ChartLegend chartType={trial.chartType} compact={compact} />}
        <GroupedBarChart
          senses={stimulus.senses}
          meanValues={stimulus.meanValues}
          width={compact === "onboarding" ? 620 : compact === "mini" ? 220 : 500}
          height={compact === "onboarding" ? 360 : compact === "mini" ? 145 : 255}
          valueRange={stimulus.valueRange}
        />
      </div>
    );
  }

  if (trial.chartType === "violin_plot") {
    const stimulus = trial.stimulus as OutlierStimulus;
    return (
      <div className="chart-figure">
        {hideCaption ? null : <p className="chart-caption">{stimulus.foodName}</p>}
        {hideLegend ? null : <ChartLegend chartType={trial.chartType} compact={compact} />}
        <ViolinPlot
          senses={stimulus.senses}
          distribution={stimulus.distribution}
          width={compact === "onboarding" ? 620 : compact === "mini" ? 220 : 500}
          height={compact === "onboarding" ? 360 : compact === "mini" ? 145 : 255}
          valueRange={stimulus.valueRange}
        />
      </div>
    );
  }

  if (trial.chartType === "outlier_radar") {
    const stimulus = trial.stimulus as OutlierStimulus;
    return (
      <div className="chart-figure">
        {hideCaption ? null : <p className="chart-caption">{stimulus.foodName}</p>}
        {hideLegend ? null : <ChartLegend chartType={trial.chartType} compact={compact} />}
        <OutlierRadarChart
          senses={stimulus.senses}
          meanValues={stimulus.meanValues}
          distribution={stimulus.distribution}
          outliers={stimulus.outliers}
          showOutliers={false}
          size={compact === "onboarding" ? 390 : compact === "mini" ? 175 : 235}
          valueRange={stimulus.valueRange}
        />
      </div>
    );
  }

  if (trial.chartType === "overlaid_radar") {
    const stimulus = trial.stimulus as ComparisonStimulus;
    return (
      <div className="chart-figure">
        {hideCaption ? null : (
          <p className="chart-caption">
            {stimulus.foodName} | Subgroup: {stimulus.subgroupLabel}
          </p>
        )}
        {hideLegend ? null : <ChartLegend chartType={trial.chartType} compact={compact} />}
        <OverlaidRadarChart
          senses={stimulus.senses}
          baselineMean={stimulus.baselineMean}
          compareMean={stimulus.compareMean}
          size={compact === "onboarding" ? 390 : compact === "mini" ? 180 : 245}
          valueRange={stimulus.valueRange}
        />
      </div>
    );
  }

  const stimulus = trial.stimulus as ComparisonStimulus;
  return (
    <div className="chart-figure">
      {hideCaption ? null : (
        <p className="chart-caption">
          {stimulus.foodName} | Subgroup: {stimulus.subgroupLabel}
        </p>
      )}
      {hideLegend ? null : <ChartLegend chartType={trial.chartType} compact={compact} />}
      <ZGlyph
        senses={stimulus.senses}
        baselineMean={stimulus.baselineMean}
        baselineStDev={stimulus.baselineStDev}
        compareMean={stimulus.compareMean}
        size={compact === "onboarding" ? 360 : compact === "mini" ? 170 : 225}
      />
    </div>
  );
}
