const SESSION_KEY = "flavor-charter-study-session";

export type SavedTrialResponse = {
  participantId?: string;
  trialId: string;
  blockId: string;
  partId?: string;
  kind: "practice" | "real";
  chartType: string;
  promptType: string;
  taskType?: string;
  answer: string;
  correctAnswer: string;
  isCorrect: boolean;
  responseTimeMs: number;
  difficulty?: string;
  trialOrderIndex?: number;
  answeredAt: string;
  foodName: string;
  subgroupLabel?: string;
  timeSinceSessionStartMs?: number;
};

export type SavedSubjectiveAnswers = Record<
  string,
  Record<string, Record<string, string>>
>;

export type SavedFinalPreferences = Record<string, string>;

export type SavedSession = {
  participantId: string;
  sessionType?: "real" | "test";
  currentStep: number;
  consentAccepted: boolean;
  consentAcceptedAt?: string;
  sessionStartedAt?: string;
  backgroundAnswers: Record<string, string>;
  trialResponses: SavedTrialResponse[];
  subjectiveAnswers?: SavedSubjectiveAnswers;
  finalPreferences?: SavedFinalPreferences;
  finalComment?: string;
  submittedAt?: string;
};

export function createEmptySession(): SavedSession {
  const token = crypto.randomUUID().slice(0, 8);
  return {
    participantId: `REAL_${token}`,
    sessionType: "real",
    currentStep: 0,
    consentAccepted: false,
    backgroundAnswers: {},
    trialResponses: [],
  };
}

export function loadSession(): SavedSession | null {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SavedSession;
  } catch {
    return null;
  }
}

export function saveSession(session: SavedSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}
