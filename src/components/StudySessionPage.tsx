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
  | { type: "groupIntro"; group: TutorialGroup }
  | { type: "onboarding"; group: TutorialGroup; screenIndex: number }
  | { type: "practiceIntro"; group: TutorialGroup }
  | { type: "trial"; block: StudyBlock; trial: Trial }
  | { type: "realIntro"; group: TutorialGroup }
  | { type: "subjective"; block: StudyBlock }
  | { type: "finalSurvey" }
  | { type: "complete" };

type TutorialGroup = {
  id: "group1" | "group2" | "group3";
  partLabel: "Part A" | "Part B";
  title: string;
  intro: string;
  blocks: StudyBlock[];
  tutorialCharts: ChartType[];
  tutorialTrials: Trial[];
  practiceTrial: Trial;
  subjectiveBlock?: StudyBlock;
};

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
    const groups = buildTutorialGroups(pack);
    const items: Step[] = [{ type: "consent" }, { type: "background" }, { type: "intro" }];
    for (const group of groups) {
      items.push({ type: "groupIntro", group });
      group.tutorialCharts.forEach((_, screenIndex) => {
        items.push({ type: "onboarding", group, screenIndex });
      });
      items.push({ type: "practiceIntro", group });
      const practiceBlock =
        group.blocks.find((block) => block.id === group.practiceTrial.blockId) ??
        group.blocks[0];
      items.push({ type: "trial", block: practiceBlock, trial: group.practiceTrial });
      items.push({ type: "realIntro", group });
      for (const block of group.blocks) {
        for (const trial of block.realTrials) {
          items.push({ type: "trial", block, trial });
        }
      }
      if (group.subjectiveBlock?.subjectiveSection) {
        items.push({ type: "subjective", block: group.subjectiveBlock });
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

        {currentStep.type === "groupIntro" ? (
          <article className="card">
            <p className="eyebrow">{currentStep.group.partLabel}</p>
            <h2>{currentStep.group.title}</h2>
            <p className="muted">{currentStep.group.intro}</p>
            <p className="muted">
              You will see all chart types used in this group before practice begins.
            </p>
            <button className="primary-button" onClick={goToNextStep}>
              Start Tutorial
            </button>
          </article>
        ) : null}

        {currentStep.type === "onboarding" ? (
          <OnboardingScreen
            group={currentStep.group}
            screenIndex={currentStep.screenIndex}
            previewTrial={onboardingPreviewForStep(currentStep.group, currentStep.screenIndex)}
            onBack={goToPreviousStep}
            onNext={goToNextStep}
            onSkip={() => skipOnboarding(steps, currentStep, setSession)}
          />
        ) : null}

        {currentStep.type === "practiceIntro" ? (
          <article className="card">
            <p className="eyebrow">Practice</p>
            <h2>{currentStep.group.title}</h2>
            <p className="muted">
              You will now begin the practice example for this group.
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
            <h2>{currentStep.group.title}</h2>
            <p className="muted">You have finished the practice example.</p>
            <p className="muted">
              The next screens are the main study questions for this group. Feedback will no longer be shown.
            </p>
            <button className="primary-button" onClick={goToNextStep}>
              Start Main Trials
            </button>
          </article>
        ) : null}

        {currentStep.type === "trial" ? (
          <article
            className={`card fixed-screen-card trial-layout ${
              currentStep.trial.answerMode === "multi_select_indices"
                ? "multi-select-trial-layout"
                : "single-answer-trial-layout"
            }`}
          >
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

            <div className="trial-content-frame">
              <div className="chart-panel">
                {currentStep.trial.answerMode === "multi_select_indices" ? (
                  <MultiSelectCardGrid
                    trial={currentStep.trial}
                    activeMultiAnswer={activeMultiAnswer}
                    onToggleMulti={toggleMultiAnswer}
                  />
                ) : (
                  <ChartRenderer
                    trial={currentStep.trial}
                    compact={false}
                    hideLegend={currentStep.trial.kind === "real"}
                  />
                )}
              </div>

              {currentStep.trial.answerMode === "multi_select_indices" ? null : (
                <div className="answer-panel">
                  <h3>{answerPanelTitle(currentStep.trial.answerMode)}</h3>
                  <AnswerEditor
                    trial={currentStep.trial}
                    activeSingleAnswer={activeSingleAnswer}
                    activeMultiAnswer={activeMultiAnswer}
                    onSingleAnswer={setActiveSingleAnswer}
                    onToggleMulti={toggleMultiAnswer}
                  />
                  <div className="answer-panel-actions">
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
                </div>
              )}
            </div>

            {currentStep.trial.answerMode === "multi_select_indices" ? (
              <div className="trial-action-bar">
                <div className="action-summary muted small">
                  {`Selected indices: ${
                    activeMultiAnswer.length ? activeMultiAnswer.join(", ") : "None yet"
                  }`}
                </div>
                <div className="action-controls">
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
              </div>
            ) : null}
          </article>
        ) : null}

        {currentStep.type === "subjective" && currentStep.block.subjectiveSection ? (
          <article className="card fixed-screen-card survey-card">
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
          <article className="card fixed-screen-card survey-card final-survey-card">
            <h2>Final questions</h2>
            <div className="question-grid final-preference-grid">
              {pack.finalPreferenceQuestions.map((question) => (
                <fieldset key={question.id} className="question-group">
                  <legend>{question.label}</legend>
                  <div className="reference-option-grid">
                    {question.options.map((option) => (
                      <label key={option} className="reference-option-row">
                        <input
                          type="radio"
                          name={question.id}
                          checked={(session.finalPreferences ?? {})[question.id] === option}
                          onChange={() => updateFinalPreference(question.id, option)}
                        />
                        <span className="reference-option-card">
                          <span className="reference-option-title">{option}</span>
                          <ReferenceFigure
                            chartType={chartTypeFromOptionLabel(option)}
                            compact="survey"
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <label className="question-group" style={{ display: "grid", gap: 8 }}>
              <span>{pack.finalCommentPrompt}</span>
              <textarea
                rows={3}
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

function MultiSelectCardGrid({
  trial,
  activeMultiAnswer,
  onToggleMulti,
}: {
  trial: Trial;
  activeMultiAnswer: string[];
  onToggleMulti: (value: string) => void;
}) {
  if (trial.stimulus.stimulusKind !== "multi_food") {
    return null;
  }

  return (
    <div className="multi-select-frame">
      <ChartLegend chartType={trial.chartType} />
      <div className="food-panel-grid selectable-food-grid">
        {trial.stimulus.foods.map((food) => {
          const option = String(food.index);
          const isSelected = activeMultiAnswer.includes(option);
          return (
            <label
              key={`${trial.id}-${food.index}`}
              className={`food-panel-card selectable-food-card ${
                isSelected ? "selected" : ""
              }`}
            >
              <div className="food-panel-head selectable-food-head">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleMulti(option)}
                />
                <span className="food-panel-index">{food.index}</span>
                <span className="food-panel-name">{food.foodName}</span>
              </div>
              <div className="food-panel-chart">
                {trial.chartType === "distribution_radar" ? (
                  <OutlierRadarChart
                    senses={trial.stimulus.senses}
                    meanValues={food.meanValues}
                    distribution={food.distribution}
                    showOutliers={false}
                    size={126}
                    valueRange={trial.stimulus.valueRange}
                    showLabels={false}
                  />
                ) : trial.chartType === "histogram_small_multiples" ? (
                  <HistogramSmallMultiples
                    senses={trial.stimulus.senses}
                    distribution={food.distribution}
                    width={210}
                    height={132}
                    valueRange={trial.stimulus.valueRange}
                  />
                ) : (
                  <StackedBarDistributionChart
                    senses={trial.stimulus.senses}
                    distribution={food.distribution}
                    width={210}
                    height={132}
                    valueRange={trial.stimulus.valueRange}
                  />
                )}
              </div>
            </label>
          );
        })}
      </div>
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
  group,
  screenIndex,
  previewTrial,
  onBack,
  onNext,
  onSkip,
}: {
  group: TutorialGroup;
  screenIndex: number;
  previewTrial?: Trial;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const chartType = group.tutorialCharts[screenIndex];
  const isFirst = screenIndex === 0;
  const isLast = screenIndex === group.tutorialCharts.length - 1;
  const partLabel = group.partLabel;

  return (
    <article className="card fixed-screen-card onboarding-card">
      <div className="onboarding-stage">
        <div className="onboarding-copy">
          <p className="eyebrow">Tutorial</p>
          <h2>{partLabel}</h2>
          <p className="muted small">
            Step {screenIndex + 1} / {group.tutorialCharts.length}
          </p>
          <h3>{chartDisplayName(chartType)}</h3>
          <ul className="tutorial-bullets">
            {tutorialBullets(chartType).map((bullet) => (
              <li key={`${chartType}-${bullet}`}>{bullet}</li>
            ))}
          </ul>
          <div className="onboarding-legend">
            {chartLegendItems(chartType).map((item) => (
              <div key={`${chartType}-${item.label}`} className="onboarding-legend-item">
                <span aria-hidden="true" style={legendSwatchStyle(item)} />
                <span>{item.label}</span>
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
        <div className="onboarding-preview-panel">
          {previewTrial ? (
            <ChartRenderer
              trial={previewTrial}
              compact="onboarding"
              hideCaption
              hideLegend
            />
          ) : null}
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
          gridTemplateColumns: `minmax(220px, 1.1fr) repeat(${section.charts.length}, minmax(150px, 1fr))`,
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

function onboardingPreviewForStep(group: TutorialGroup, screenIndex: number) {
  const chartType = group.tutorialCharts[screenIndex];
  return group.tutorialTrials.find((trial) => trial.chartType === chartType);
}

function skipOnboarding(
  steps: Step[],
  currentStep: Extract<Step, { type: "onboarding" }>,
  setSession: (value: (prev: ExtendedSavedSession) => ExtendedSavedSession) => void,
) {
  const currentIndex = steps.findIndex(
    (step) =>
      step.type === "onboarding" &&
      step.group.id === currentStep.group.id &&
      step.screenIndex === currentStep.screenIndex,
  );
  const nextIndex = steps.findIndex(
    (step, index) =>
      index > currentIndex &&
      !(step.type === "onboarding" && step.group.id === currentStep.group.id),
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

function tutorialBullets(chartType: ChartType) {
  switch (chartType) {
    case "distribution_radar":
      return [
        "Outline shows the average profile.",
        "Bands show how ratings are distributed.",
      ];
    case "histogram_small_multiples":
      return [
        "Each panel shows one attribute.",
        "Concentration indicates agreement.",
      ];
    case "stacked_bar_distribution":
      return [
        "Each bar shows the full distribution.",
        "More area at high values means stronger support.",
      ];
    case "zchart":
      return [
        "Direction shows above or below the reference group.",
        "Larger displacement means larger difference.",
      ];
    case "dual_histogram":
      return [
        "Each side shows one population.",
        "Separated shapes indicate stronger differences.",
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
  return <ReferenceFigure chartType={chartType} compact="mini" />;
}

function ReferenceFigure({
  chartType,
  compact = "mini",
}: {
  chartType: ChartType;
  compact?: "mini" | "onboarding" | "survey";
}) {
  const width = compact === "onboarding" ? 240 : compact === "survey" ? 160 : 140;
  const height = compact === "onboarding" ? 150 : compact === "survey" ? 110 : 96;

  if (chartType === "distribution_radar") {
    return (
      <svg width={width} height={height} viewBox="0 0 180 120" aria-label={chartDisplayName(chartType)}>
        <circle cx="90" cy="60" r="18" fill="none" stroke="#e2e8f0" />
        <circle cx="90" cy="60" r="34" fill="none" stroke="#e2e8f0" />
        <circle cx="90" cy="60" r="50" fill="none" stroke="#e2e8f0" />
        <polygon points="90,15 128,34 140,70 108,100 72,102 40,72 48,34" fill="rgba(245,158,11,0.24)" />
        <polyline points="90,22 120,38 130,68 106,88 74,90 50,66 58,38 90,22" fill="none" stroke="#dc2626" strokeWidth="3" />
      </svg>
    );
  }

  if (chartType === "histogram_small_multiples") {
    return (
      <svg width={width} height={height} viewBox="0 0 180 120" aria-label={chartDisplayName(chartType)}>
        {[0, 1, 2, 3].map((panel) => {
          const x = 16 + (panel % 2) * 76;
          const y = 12 + Math.floor(panel / 2) * 48;
          return (
            <g key={panel}>
              <rect x={x} y={y} width="68" height="40" rx="8" fill="#fff" stroke="#e2e8f0" />
              {[0, 1, 2, 3, 4].map((bar) => (
                <rect
                  key={bar}
                  x={x + 8 + bar * 11}
                  y={y + 28 - ((bar + panel) % 4) * 5}
                  width="7"
                  height={10 + ((bar + panel) % 4) * 5}
                  rx="2"
                  fill="#0f766e"
                />
              ))}
            </g>
          );
        })}
      </svg>
    );
  }

  if (chartType === "stacked_bar_distribution") {
    return (
      <svg width={width} height={height} viewBox="0 0 180 120" aria-label={chartDisplayName(chartType)}>
        {[0, 1, 2, 3].map((row) => {
          const y = 18 + row * 22;
          return (
            <g key={row}>
              <rect x="26" y={y} width="24" height="10" fill="#fef3c7" rx="3" />
              <rect x="50" y={y} width="28" height="10" fill="#fde68a" rx="3" />
              <rect x="78" y={y} width="30" height="10" fill="#f59e0b" rx="3" />
              <rect x="108" y={y} width="22" height="10" fill="#d97706" rx="3" />
              <rect x="130" y={y} width="20" height="10" fill="#92400e" rx="3" />
            </g>
          );
        })}
      </svg>
    );
  }

  if (chartType === "zchart") {
    return (
      <svg width={width} height={height} viewBox="0 0 180 120" aria-label={chartDisplayName(chartType)}>
        <circle cx="90" cy="60" r="20" fill="none" stroke="#e2e8f0" />
        <circle cx="90" cy="60" r="38" fill="none" stroke="#e2e8f0" />
        <circle cx="90" cy="60" r="54" fill="none" stroke="#e2e8f0" />
        <path d="M90 18 L124 36 L132 72 L102 92 L68 94 L48 70 L58 34 Z" fill="rgba(148,163,184,0.12)" stroke="#475569" strokeWidth="2" />
        <circle cx="124" cy="36" r="4" fill="#d9534f" />
        <circle cx="132" cy="72" r="4" fill="#d9534f" />
        <circle cx="58" cy="34" r="4" fill="#0275d8" />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} viewBox="0 0 180 120" aria-label={chartDisplayName(chartType)}>
      <line x1="90" y1="14" x2="90" y2="106" stroke="#cbd5e1" strokeDasharray="4 4" />
      {[0, 1, 2, 3].map((row) => {
        const y = 18 + row * 22;
        return (
          <g key={row}>
            <rect x={52 - row * 4} y={y} width={32 + row * 4} height="10" rx="3" fill="#94a3b8" />
            <rect x="90" y={y} width={24 + row * 6} height="10" rx="3" fill="#ea580c" />
          </g>
        );
      })}
    </svg>
  );
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
        size={compact === "onboarding" ? 260 : compact === "mini" ? 150 : 250}
        valueRange={stimulus.valueRange}
      />
    );
  }

  if (chartType === "histogram_small_multiples") {
    return (
      <HistogramSmallMultiples
        senses={stimulus.senses}
        distribution={stimulus.distribution}
        width={compact === "onboarding" ? 380 : compact === "mini" ? 170 : 760}
        height={compact === "onboarding" ? 280 : compact === "mini" ? 120 : 320}
        valueRange={stimulus.valueRange}
      />
    );
  }

  return (
    <StackedBarDistributionChart
      senses={stimulus.senses}
      distribution={stimulus.distribution}
      width={compact === "onboarding" ? 380 : compact === "mini" ? 170 : 760}
      height={compact === "onboarding" ? 280 : compact === "mini" ? 120 : 320}
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
              size={compact === "mini" ? 100 : compact === "onboarding" ? 138 : 126}
              valueRange={stimulus.valueRange}
              showLabels={compact !== "mini"}
            />
          ) : chartType === "histogram_small_multiples" ? (
            <HistogramSmallMultiples
              senses={stimulus.senses}
              distribution={food.distribution}
              width={compact === "mini" ? 156 : compact === "onboarding" ? 184 : 210}
              height={compact === "mini" ? 92 : compact === "onboarding" ? 108 : 132}
              valueRange={stimulus.valueRange}
            />
          ) : (
            <StackedBarDistributionChart
              senses={stimulus.senses}
              distribution={food.distribution}
              width={compact === "mini" ? 156 : compact === "onboarding" ? 184 : 210}
              height={compact === "mini" ? 92 : compact === "onboarding" ? 108 : 132}
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
          size={compact === "onboarding" ? 250 : compact === "mini" ? 140 : 235}
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
        width={compact === "onboarding" ? 420 : compact === "mini" ? 170 : 760}
        height={compact === "onboarding" ? 280 : compact === "mini" ? 120 : 320}
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

function chartTypeFromOptionLabel(option: string): ChartType {
  const mapping = ([
    "distribution_radar",
    "histogram_small_multiples",
    "stacked_bar_distribution",
    "zchart",
    "dual_histogram",
  ] as ChartType[]).find((chartType) => chartDisplayName(chartType) === option);
  return mapping ?? "distribution_radar";
}

function buildTutorialGroups(pack: StudyPack): TutorialGroup[] {
  const [block1, block2, block3, block4, block5] = pack.blocks;
  return [
    {
      id: "group1",
      partLabel: "Part A",
      title: "Group 1: Distribution and Agreement",
      intro:
        "This group covers single-food distribution and agreement reading with the radial profile, histogram small multiples, and stacked bar distribution.",
      blocks: [block1],
      tutorialCharts: [
        "distribution_radar",
        "histogram_small_multiples",
        "stacked_bar_distribution",
      ],
      tutorialTrials: [
        pickTutorialTrial([block1], "distribution_radar"),
        pickTutorialTrial([block1], "histogram_small_multiples"),
        pickTutorialTrial([block1], "stacked_bar_distribution"),
      ],
      practiceTrial: block1.practiceTrials[0],
    },
    {
      id: "group2",
      partLabel: "Part A",
      title: "Group 2: Profile Matching Across Foods",
      intro:
        "This group covers profile similarity and spatial profile comparison across several foods using all three small-multiple chart types.",
      blocks: [block2, block3],
      tutorialCharts: [
        "distribution_radar",
        "histogram_small_multiples",
        "stacked_bar_distribution",
      ],
      tutorialTrials: [
        pickTutorialTrial([block2, block3], "distribution_radar"),
        pickTutorialTrial([block2, block3], "histogram_small_multiples"),
        pickTutorialTrial([block2, block3], "stacked_bar_distribution"),
      ],
      practiceTrial: block2.practiceTrials[0],
      subjectiveBlock: block3,
    },
    {
      id: "group3",
      partLabel: "Part B",
      title: "Group 3: Population Comparison",
      intro:
        "This group covers subgroup distribution comparison and difference magnitude with the z-score radar and the dual distribution comparison view.",
      blocks: [block4, block5],
      tutorialCharts: ["zchart", "dual_histogram"],
      tutorialTrials: [
        pickTutorialTrial([block4, block5], "zchart"),
        pickTutorialTrial([block4, block5], "dual_histogram"),
      ],
      practiceTrial: block4.practiceTrials[0],
      subjectiveBlock: block5,
    },
  ];
}

function pickTutorialTrial(blocks: StudyBlock[], chartType: ChartType): Trial {
  for (const block of blocks) {
    const preview = (block.onboardingPreviewTrials ?? []).find(
      (trial) => trial.chartType === chartType,
    );
    if (preview) return preview;
    const practice = block.practiceTrials.find((trial) => trial.chartType === chartType);
    if (practice) return practice;
    const real = block.realTrials.find((trial) => trial.chartType === chartType);
    if (real) return real;
  }
  throw new Error(`Missing tutorial preview for ${chartType}`);
}
