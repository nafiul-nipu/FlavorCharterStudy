import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import DualHistogramComparison from "./DualHistogramComparison";
import HistogramSmallMultiples from "./HistogramSmallMultiples";
import OutlierRadarChart from "./OutlierRadarChart";
import StackedBarDistributionChart from "./StackedBarDistributionChart";
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
  AnswerMode,
  ChartType,
  FoodPanel,
  MultiFoodStimulus,
  PopulationComparisonStimulus,
  SingleFoodStimulus,
  StudyBlock,
  StudyPack,
  SubjectiveSection,
  Trial,
  TrialStimulus,
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
  const [activeSingleAnswer, setActiveSingleAnswer] = useState("");
  const [activeMultiAnswer, setActiveMultiAnswer] = useState<string[]>([]);
  const [trialStartedAt, setTrialStartedAt] = useState(Date.now());
  const [minViewElapsed, setMinViewElapsed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({
    status: "idle",
    message: "",
  });

  function setSessionType(sessionType: "real" | "test") {
    setSession((prev) => {
      const currentPrefix = prev.sessionType === "test" ? "TEST_" : "REAL_";
      const nextPrefix = sessionType === "test" ? "TEST_" : "REAL_";
      const currentId = prev.participantId || "";
      const suffix = currentId.startsWith(currentPrefix)
        ? currentId.slice(currentPrefix.length)
        : crypto.randomUUID().slice(0, 8);
      return {
        ...prev,
        sessionType,
        participantId: `${nextPrefix}${suffix || crypto.randomUUID().slice(0, 8)}`,
      };
    });
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("./study-data/study-pack.json");
        if (!response.ok) {
          throw new Error(`Unable to load study pack (${response.status})`);
        }
        const data = (await response.json()) as StudyPack;
        if (!cancelled) {
          setPack(data);
        }
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
      if (block.subjectiveSection) {
        items.push({ type: "subjective", block });
      }
    }
    items.push({ type: "finalSurvey" }, { type: "complete" });
    return items;
  }, [pack]);

  const currentStep = steps[session.currentStep];

  useEffect(() => {
    if (currentStep?.type === "trial") {
      setTrialStartedAt(Date.now());
      setMinViewElapsed(false);
      setActiveSingleAnswer("");
      setActiveMultiAnswer([]);
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

  function toggleMultiAnswer(option: string) {
    setActiveMultiAnswer((prev) => {
      const next = prev.includes(option)
        ? prev.filter((item) => item !== option)
        : [...prev, option];
      return next.sort((left, right) => Number(left) - Number(right));
    });
  }

  function submitTrial(trial: Trial) {
    const userAnswer =
      trial.answerMode === "multi_select_indices"
        ? activeMultiAnswer
        : activeSingleAnswer;
    if (!isAnswerReady(trial.answerMode, userAnswer) || !minViewElapsed) return;

    const now = Date.now();
    const sessionStartedAtMs = session.sessionStartedAt
      ? new Date(session.sessionStartedAt).getTime()
      : now;
    const isCorrect = answersEqual(userAnswer, trial.correctAnswer);
    const responseKind: "practice" | "real" =
      trial.kind === "practice" ? "practice" : "real";

    const nextResponse = {
      participantId: session.participantId,
      trialId: trial.id,
      blockId: trial.blockId,
      partId: trial.partId,
      chartType: trial.chartType,
      taskType: trial.taskType,
      answerMode: trial.answerMode,
      userAnswer,
      correctAnswer: trial.correctAnswer,
      isCorrect,
      errorCount: calculateErrorCount(userAnswer, trial.correctAnswer),
      responseTimeMs: now - trialStartedAt,
      difficulty: trial.difficulty,
      trialOrderIndex: getTrialOrderIndex(currentStep, trial),
      kind: responseKind,
      answeredAt: new Date().toISOString(),
      stimulusId: trial.stimulus.stimulusId,
      foodName: trial.stimulus.foodName,
      foodNames: trial.stimulus.foodNames,
      comparisonLabel:
        trial.stimulus.stimulusKind === "population_comparison"
          ? trial.stimulus.comparisonLabel
          : undefined,
      timeSinceSessionStartMs: now - sessionStartedAtMs,
    };

    setSession((prev) => ({
      ...prev,
      trialResponses: [...prev.trialResponses, nextResponse],
    }));

    if (trial.kind === "practice") {
      setFeedback(isCorrect ? "Correct" : "Incorrect");
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
    setSubmission({
      status: "submitting",
      message:
        "Submitting responses. Important: do not close this browser tab until submission is complete.",
    });
    const result = await submitStudySession(pack, session);
    if (result.ok) {
      clearSession();
      setSubmission({
        status: "submitted",
        message:
          "Responses submitted successfully. You may now close this browser tab.",
      });
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
  const activeResponse =
    currentStep.type === "trial" && currentStep.trial.answerMode === "multi_select_indices"
      ? activeMultiAnswer
      : activeSingleAnswer;
  const canSubmit =
    currentStep.type === "trial"
      ? isAnswerReady(currentStep.trial.answerMode, activeResponse) && minViewElapsed
      : false;

  return (
    <main className="shell">
      <section className="study-frame">
        <header className="study-header">
          <div>
            <p className="eyebrow">Visualization Study</p>
            <h1>{pack.title}</h1>
          </div>
          <div className="progress-panel">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <p className="muted small">
              Participant: <code>{session.participantId}</code> | Step {session.currentStep + 1} /{" "}
              {steps.length}
            </p>
          </div>
        </header>

        {currentStep.type === "consent" ? (
          <article className="card info-card consent-card">
            <h2>Consent and study overview</h2>
            {pack.consentText.map((line) => (
              <FormattedParagraph key={line} text={line} className="muted" />
            ))}
            <label
              className="muted"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.65rem",
                margin: "0.75rem 0 1rem",
              }}
            >
              <input
                type="checkbox"
                style={{ marginTop: "0.2rem" }}
                checked={session.sessionType === "test"}
                onChange={(event) =>
                  setSessionType(event.target.checked ? "test" : "real")
                }
              />
              <span>
                <span>This is a pilot/test session (research team only).</span>
                <span
                  className="muted small"
                  style={{ display: "block", marginTop: "0.2rem" }}
                >
                  Do not check this box if you are a real participant.
                </span>
              </span>
            </label>
            <p className="muted small" style={{ marginTop: 0 }}>
              Session ID: <code>{session.participantId}</code>
            </p>
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
              disabled={pack.backgroundQuestions.some(
                (question) => !backgroundDraft[question.id],
              )}
            >
              Save and continue
            </button>
          </article>
        ) : null}

        {currentStep.type === "intro" ? (
          <article className="card info-card intro-card">
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
            <p className="eyebrow">
              {currentStep.block.partId === "part_a" ? "Part A" : "Part B"}
            </p>
            <h2>{currentStep.block.title}</h2>
            <p className="muted">{currentStep.block.intro}</p>
            <p className="muted">
              {currentStep.block.onboarding.length
                ? "You will first see a short tutorial for the chart family used in this section."
                : "You can now begin practice for this block."}
            </p>
            <button className="primary-button" onClick={goToNextStep}>
              {currentStep.block.onboarding.length ? "Start Tutorial" : "Start Practice"}
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
            <p className="eyebrow">Practice</p>
            <h2>{currentStep.block.title}</h2>
            <p className="muted">
              You will now begin the practice example for this block.
            </p>
            <p className="muted">Practice responses give immediate correctness feedback.</p>
            <button className="primary-button" onClick={goToNextStep}>
              Start Practice
            </button>
          </article>
        ) : null}

        {currentStep.type === "realIntro" ? (
          <article className="card">
            <p className="eyebrow">Main Study</p>
            <h2>{currentStep.block.title}</h2>
            <p className="muted">You have finished the practice example.</p>
            <p className="muted">
              The next screens are the main study questions. Feedback will no longer be shown.
            </p>
            <button className="primary-button" onClick={goToNextStep}>
              Start Main Trials
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
                <h2>
                  {currentStep.block.title} ({chartDisplayName(currentStep.trial.chartType)})
                </h2>
                <p className="muted">{currentStep.block.taskInstruction}</p>
                <p className="trial-question">
                  <strong>{currentStep.trial.prompt}</strong>
                </p>
              </div>
            </div>

            <div className="answer-panel">
              <h3>{answerPanelTitle(currentStep.trial.answerMode)}</h3>
              <AnswerEditor
                trial={currentStep.trial}
                activeSingleAnswer={activeSingleAnswer}
                activeMultiAnswer={activeMultiAnswer}
                onSingleAnswer={setActiveSingleAnswer}
                onToggleMulti={toggleMultiAnswer}
              />

              {currentStep.trial.answerMode === "multi_select_indices" ? (
                <p className="muted small">
                  Selected indices:{" "}
                  {activeMultiAnswer.length ? activeMultiAnswer.join(", ") : "None yet"}
                </p>
              ) : null}

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

        {currentStep.type === "subjective" && currentStep.block.subjectiveSection ? (
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
              disabled={
                !isSubjectiveSectionComplete(
                  currentStep.block.subjectiveSection,
                  session,
                  currentStep.block.id,
                )
              }
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
              Thank you for completing the study. Your background answers, trial
              responses, response times, chart ratings, and final preferences are now
              stored in this session.
            </p>
            <div className="summary-strip">
              <span>
                Main trials answered:{" "}
                {session.trialResponses.filter((item) => item.kind === "real").length}
              </span>
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
                  setSession({
                    ...createEmptySession(),
                    sessionStartedAt: new Date().toISOString(),
                  });
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

function AnswerEditor({
  trial,
  activeSingleAnswer,
  activeMultiAnswer,
  onSingleAnswer,
  onToggleMulti,
}: {
  trial: Trial;
  activeSingleAnswer: string;
  activeMultiAnswer: string[];
  onSingleAnswer: (value: string) => void;
  onToggleMulti: (value: string) => void;
}) {
  if (trial.answerMode === "multi_select_indices") {
    return (
      <div className="question-grid">
        {trial.options.map((option) => (
          <label key={option} className="option-row">
            <input
              type="checkbox"
              checked={activeMultiAnswer.includes(option)}
              onChange={() => onToggleMulti(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="question-grid">
      {trial.options.map((option) => (
        <label key={option} className="option-row">
          <input
            type="radio"
            name={trial.id}
            checked={activeSingleAnswer === option}
            onChange={() => onSingleAnswer(option)}
          />
          <span>{option}</span>
        </label>
      ))}
    </div>
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
          <p className="eyebrow">Tutorial</p>
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
                  <span className="onboarding-note-dot" aria-hidden="true" />
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
            <button className="secondary-button" onClick={onBack} disabled={isFirst}>
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
        style={{
          gridTemplateColumns: `minmax(260px, 1.4fr) repeat(${section.charts.length}, minmax(220px, 1fr))`,
        }}
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
      !(step.type === "onboarding" && step.block.id === currentStep.block.id),
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

function answerPanelTitle(answerMode: AnswerMode) {
  switch (answerMode) {
    case "multi_select_indices":
      return "Select all matching indices";
    case "binary_choice":
      return "Choose one answer";
    case "single_choice_tuple":
      return "Select one answer";
    default:
      return "Answer";
  }
}

function chartDisplayName(chartType: ChartType) {
  switch (chartType) {
    case "distribution_radar":
      return "Distribution-Aware Radial Profile";
    case "histogram_small_multiples":
      return "Histogram Small Multiples";
    case "stacked_bar_distribution":
      return "Stacked Bar Distribution";
    case "zchart":
      return "Z-Score Radar Chart";
    case "dual_histogram":
      return "Dual Histogram Comparison";
    default:
      return chartType;
  }
}

function chartLegendItems(chartType: ChartType) {
  switch (chartType) {
    case "distribution_radar":
      return [
        { label: "Profile outline", kind: "line" as const, color: "#dc2626" },
        { label: "Distribution bands", kind: "fill" as const, color: "#f59e0b" },
      ];
    case "histogram_small_multiples":
      return [
        { label: "Frequency bars", kind: "fill" as const, color: "#0f766e" },
      ];
    case "stacked_bar_distribution":
      return [
        { label: "Stacked rating shares", kind: "fill" as const, color: "#f59e0b" },
      ];
    case "zchart":
      return [
        { label: "Higher than population A", kind: "dot" as const, color: "#d9534f" },
        { label: "Lower than population A", kind: "dot" as const, color: "#0275d8" },
      ];
    case "dual_histogram":
      return [
        { label: "Population A", kind: "fill" as const, color: "#94a3b8" },
        { label: "Population B", kind: "fill" as const, color: "#ea580c" },
      ];
    default:
      return [];
  }
}

function onboardingNotes(chartType: ChartType) {
  switch (chartType) {
    case "distribution_radar":
      return [
        {
          title: "Agreement cues",
          body: "Look for attributes with visible support in the higher rating bands, especially when that support is concentrated rather than diffuse.",
        },
        {
          title: "Profile reading",
          body: "The shape gives a fast profile summary, while the bands help you judge how strongly the ratings support that profile.",
        },
      ];
    case "histogram_small_multiples":
      return [
        {
          title: "Per-attribute panels",
          body: "Each panel isolates one taste dimension so you can compare distribution shape and concentration across attributes.",
        },
        {
          title: "Support and spread",
          body: "Bars concentrated toward higher rating values indicate stronger support for that attribute.",
        },
      ];
    case "stacked_bar_distribution":
      return [
        {
          title: "Whole-distribution bars",
          body: "Each bar represents the full distribution of ratings for one attribute, with shading indicating how responses are split across levels.",
        },
        {
          title: "Comparing support",
          body: "Attributes with more bar area in the higher-value segments are more strongly supported by the ratings.",
        },
      ];
    case "zchart":
      return [
        {
          title: "Direction",
          body: "Direction indicates whether population B is above or below population A for an attribute.",
        },
        {
          title: "Magnitude",
          body: "Larger displacement indicates larger distributional differences.",
        },
      ];
    case "dual_histogram":
      return [
        {
          title: "Mirrored comparison",
          body: "The left side shows population A and the right side shows population B for the same attribute and rating levels.",
        },
        {
          title: "Difference size",
          body: "Large shifts in where the two sides concentrate indicate stronger population differences.",
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
  const trial = buildPreviewTrial(chartType);
  return <ChartRenderer trial={trial} compact="mini" hideCaption hideLegend />;
}

function buildPreviewTrial(chartType: ChartType): Trial {
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
        "0": { count: index % 2, percent: 6 + (index % 3) },
        "1": { count: 1 + (index % 3), percent: 10 + (index % 4) },
        "2": { count: 2 + ((index + 1) % 3), percent: 13 + (index % 3) },
        "3": { count: 3 + (index % 2), percent: 18 + ((index + 1) % 3) },
        "4": { count: 4 + (index % 3), percent: 24 + (index % 4) },
        "5": { count: 2 + (index % 2), percent: 14 + (index % 3) },
      },
    ]),
  );

  const singleStimulus: SingleFoodStimulus = {
    stimulusId: `preview-${chartType}`,
    stimulusKind: "single_food",
    foodName: "Example food",
    foodNames: ["Example food"],
    count: 36,
    senses,
    valueRange: { min: 0, max: 5 },
    meanValues: {
      Sweetness: 3.2,
      Sourness: 1.7,
      Saltiness: 2.8,
      Bitterness: 1.9,
      Savoriness: 2.4,
      Fatness: 3.1,
      Astringency: 1.4,
      Aromaticity: 3.6,
      Texture: 3.0,
      Piquancy: 2.3,
    },
    stdevs: {
      Sweetness: 0.8,
      Sourness: 0.7,
      Saltiness: 0.6,
      Bitterness: 0.7,
      Savoriness: 0.8,
      Fatness: 0.9,
      Astringency: 0.5,
      Aromaticity: 0.7,
      Texture: 0.8,
      Piquancy: 0.9,
    },
    distribution,
  };

  const multiStimulus: MultiFoodStimulus = {
    stimulusId: `preview-multi-${chartType}`,
    stimulusKind: "multi_food",
    foodName: "Preview foods",
    foodNames: ["Food 1", "Food 2", "Food 3"],
    senses,
    valueRange: { min: 0, max: 5 },
    targetProfileKeys: ["Sweetness", "Aromaticity", "Texture"],
    targetProfileLabels: ["Sweet", "Aromatic", "Texture"],
    foods: [1, 2, 3].map((index) => ({
      index,
      foodName: `Food ${index}`,
      count: 28 + index,
      meanValues: singleStimulus.meanValues,
      stdevs: singleStimulus.stdevs,
      distribution,
    })),
  };

  const comparisonStimulus: PopulationComparisonStimulus = {
    stimulusId: `preview-comparison-${chartType}`,
    stimulusKind: "population_comparison",
    foodName: "Example food",
    foodNames: ["Example food"],
    comparisonLabel: "Population A vs Population B",
    populationA: {
      id: "a",
      label: "Population A",
      count: 18,
      meanValues: {
        Sweetness: 2.4,
        Sourness: 1.9,
        Saltiness: 2.6,
        Bitterness: 1.5,
        Savoriness: 2.2,
        Fatness: 2.0,
        Astringency: 1.2,
        Aromaticity: 2.4,
        Texture: 2.5,
        Piquancy: 1.4,
      },
      stdevs: {
        Sweetness: 0.7,
        Sourness: 0.5,
        Saltiness: 0.8,
        Bitterness: 0.5,
        Savoriness: 0.6,
        Fatness: 0.6,
        Astringency: 0.4,
        Aromaticity: 0.8,
        Texture: 0.7,
        Piquancy: 0.5,
      },
      distribution,
    },
    populationB: {
      id: "b",
      label: "Population B",
      count: 17,
      meanValues: {
        Sweetness: 3.0,
        Sourness: 1.5,
        Saltiness: 2.1,
        Bitterness: 2.1,
        Savoriness: 2.8,
        Fatness: 2.6,
        Astringency: 1.6,
        Aromaticity: 3.1,
        Texture: 1.9,
        Piquancy: 2.0,
      },
      stdevs: {
        Sweetness: 0.8,
        Sourness: 0.5,
        Saltiness: 0.7,
        Bitterness: 0.6,
        Savoriness: 0.7,
        Fatness: 0.7,
        Astringency: 0.5,
        Aromaticity: 0.8,
        Texture: 0.6,
        Piquancy: 0.6,
      },
      distribution,
    },
    senses,
    valueRange: { min: 0, max: 5 },
  };

  const stimulus: TrialStimulus =
    chartType === "distribution_radar"
      ? singleStimulus
      : chartType === "histogram_small_multiples" ||
          chartType === "stacked_bar_distribution"
        ? multiStimulus
        : comparisonStimulus;

  return {
    id: `subjective-${chartType}`,
    blockId: "preview",
    partId: "preview",
    kind: "preview",
    chartType,
    taskType: "tutorial_preview",
    answerMode: "none",
    prompt: "",
    options: [],
    correctAnswer: "",
    stimulus,
  };
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
  return (
    <div className="chart-figure">
      {hideCaption ? null : <ChartCaption stimulus={trial.stimulus} />}
      {hideLegend ? null : <ChartLegend chartType={trial.chartType} compact={compact} />}
      {trial.stimulus.stimulusKind === "single_food"
        ? renderSingleFoodVisualization(trial.chartType, trial.stimulus, compact)
        : trial.stimulus.stimulusKind === "multi_food"
          ? renderMultiFoodVisualization(trial.chartType, trial.stimulus, compact)
          : renderPopulationComparison(trial.chartType, trial.stimulus, compact)}
    </div>
  );
}

function ChartCaption({ stimulus }: { stimulus: TrialStimulus }) {
  if (stimulus.stimulusKind === "population_comparison") {
    return (
      <p className="chart-caption">
        {stimulus.foodName} | {stimulus.comparisonLabel}
      </p>
    );
  }

  if (stimulus.stimulusKind === "multi_food") {
    return (
      <p className="chart-caption">
        Target profile: {stimulus.targetProfileLabels.join(", ")}
      </p>
    );
  }

  return <p className="chart-caption">{stimulus.foodName}</p>;
}

function renderSingleFoodVisualization(
  chartType: ChartType,
  stimulus: SingleFoodStimulus,
  compact: false | "onboarding" | "mini",
) {
  if (chartType === "distribution_radar") {
    return (
      <OutlierRadarChart
        senses={stimulus.senses}
        meanValues={stimulus.meanValues}
        distribution={stimulus.distribution}
        showOutliers={false}
        size={compact === "onboarding" ? 360 : compact === "mini" ? 170 : 235}
        valueRange={stimulus.valueRange}
      />
    );
  }

  if (chartType === "histogram_small_multiples") {
    return (
      <HistogramSmallMultiples
        senses={stimulus.senses}
        distribution={stimulus.distribution}
        width={compact === "onboarding" ? 620 : compact === "mini" ? 220 : 520}
        height={compact === "onboarding" ? 360 : compact === "mini" ? 180 : 320}
        valueRange={stimulus.valueRange}
      />
    );
  }

  return (
    <StackedBarDistributionChart
      senses={stimulus.senses}
      distribution={stimulus.distribution}
      width={compact === "onboarding" ? 620 : compact === "mini" ? 220 : 520}
      height={compact === "onboarding" ? 360 : compact === "mini" ? 180 : 320}
      valueRange={stimulus.valueRange}
    />
  );
}

function renderMultiFoodVisualization(
  chartType: ChartType,
  stimulus: MultiFoodStimulus,
  compact: false | "onboarding" | "mini",
) {
  return (
    <div className="food-panel-grid">
      {stimulus.foods.map((food) => (
        <FoodPanelCard key={`${stimulus.stimulusId}-${food.index}`} food={food}>
          {chartType === "distribution_radar" ? (
            <OutlierRadarChart
              senses={stimulus.senses}
              meanValues={food.meanValues}
              distribution={food.distribution}
              showOutliers={false}
              size={compact === "mini" ? 115 : compact === "onboarding" ? 170 : 135}
              valueRange={stimulus.valueRange}
              showLabels={compact !== "mini"}
            />
          ) : chartType === "histogram_small_multiples" ? (
            <HistogramSmallMultiples
              senses={stimulus.senses}
              distribution={food.distribution}
              width={compact === "mini" ? 170 : compact === "onboarding" ? 220 : 190}
              height={compact === "mini" ? 150 : compact === "onboarding" ? 210 : 170}
              valueRange={stimulus.valueRange}
            />
          ) : (
            <StackedBarDistributionChart
              senses={stimulus.senses}
              distribution={food.distribution}
              width={compact === "mini" ? 170 : compact === "onboarding" ? 220 : 190}
              height={compact === "mini" ? 150 : compact === "onboarding" ? 210 : 170}
              valueRange={stimulus.valueRange}
            />
          )}
        </FoodPanelCard>
      ))}
    </div>
  );
}

function renderPopulationComparison(
  chartType: ChartType,
  stimulus: PopulationComparisonStimulus,
  compact: false | "onboarding" | "mini",
) {
  if (chartType === "zchart") {
    return (
      <div className="comparison-stack">
        <p className="muted small comparison-label-row">
          <span>{stimulus.populationA.label}</span>
          <span>vs</span>
          <span>{stimulus.populationB.label}</span>
        </p>
        <ZGlyph
          senses={stimulus.senses}
          baselineMean={stimulus.populationA.meanValues}
          baselineStDev={stimulus.populationA.stdevs}
          compareMean={stimulus.populationB.meanValues}
          size={compact === "onboarding" ? 340 : compact === "mini" ? 160 : 220}
        />
      </div>
    );
  }

  return (
    <div className="comparison-stack">
      <p className="muted small comparison-label-row">
        <span>{stimulus.populationA.label}</span>
        <span>vs</span>
        <span>{stimulus.populationB.label}</span>
      </p>
      <DualHistogramComparison
        senses={stimulus.senses}
        populationA={{
          label: stimulus.populationA.label,
          distribution: stimulus.populationA.distribution,
        }}
        populationB={{
          label: stimulus.populationB.label,
          distribution: stimulus.populationB.distribution,
        }}
        width={compact === "onboarding" ? 620 : compact === "mini" ? 220 : 520}
        height={compact === "onboarding" ? 360 : compact === "mini" ? 180 : 320}
        valueRange={stimulus.valueRange}
      />
    </div>
  );
}

function FoodPanelCard({
  food,
  children,
}: {
  food: FoodPanel;
  children: ReactNode;
}) {
  return (
    <div className="food-panel-card">
      <div className="food-panel-head">
        <span className="food-panel-index">{food.index}</span>
        <span className="food-panel-name">{food.foodName}</span>
      </div>
      <div className="food-panel-chart">{children}</div>
    </div>
  );
}

function isAnswerReady(answerMode: AnswerMode, answer: string | string[]) {
  if (answerMode === "multi_select_indices") {
    return Array.isArray(answer) && answer.length > 0;
  }
  return typeof answer === "string" && answer.length > 0;
}

function answersEqual(left: string | string[], right: string | string[]) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.join("|") === right.join("|");
  }
  return left === right;
}

function calculateErrorCount(userAnswer: string | string[], correctAnswer: string | string[]) {
  if (Array.isArray(userAnswer) && Array.isArray(correctAnswer)) {
    const user = new Set(userAnswer);
    const correct = new Set(correctAnswer);
    let errors = 0;
    for (const value of user) {
      if (!correct.has(value)) errors += 1;
    }
    for (const value of correct) {
      if (!user.has(value)) errors += 1;
    }
    return errors;
  }
  return userAnswer === correctAnswer ? 0 : 1;
}
