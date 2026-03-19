export type MeansByTaste = Record<string, number>;
export type StdevsByTaste = Record<string, number>;
export type OutliersByTaste = Record<string, number[]>;
export type DistributionByTaste = Record<
  string,
  Record<string, { count: number; percent: number }>
>;

export type ChartType =
  | "grouped_bar"
  | "violin_plot"
  | "outlier_radar"
  | "overlaid_radar"
  | "zglyph";

export type TaskType =
  | "highest_mean"
  | "highest_variability"
  | "higher_than_baseline"
  | "largest_deviation"
  | "tutorial_preview";

export type Difficulty = "easy" | "medium" | "hard";

export type OutlierStimulus = {
  foodName: string;
  count: number;
  senses: Record<string, string>;
  valueRange: { min: number; max: number };
  meanValues: MeansByTaste;
  stdevs: StdevsByTaste;
  distribution: DistributionByTaste;
  outliers: OutliersByTaste;
};

export type ComparisonStimulus = {
  foodName: string;
  count: number;
  senses: Record<string, string>;
  valueRange: { min: number; max: number };
  baselineMean: MeansByTaste;
  baselineStDev: StdevsByTaste;
  compareMean: MeansByTaste;
  subgroupLabel: string;
};

export type Trial = {
  id: string;
  blockId: string;
  partId: string;
  kind: "practice" | "real" | "preview";
  chartType: ChartType;
  taskType: TaskType;
  difficulty?: Difficulty;
  clarityMargin?: number;
  prompt: string;
  options: string[];
  correctAnswer: string;
  stimulus: OutlierStimulus | ComparisonStimulus;
};

export type TutorialSection = {
  chartType: ChartType;
  title: string;
  callouts: string[];
};

export type SubjectiveQuestion = {
  id: string;
  label: string;
};

export type SubjectiveChart = {
  chartType: ChartType;
  title: string;
};

export type SubjectiveSection = {
  id: string;
  title: string;
  instructions: string;
  charts: SubjectiveChart[];
  questions: SubjectiveQuestion[];
  scaleOptions: string[];
};

export type BackgroundQuestion = {
  id: string;
  label: string;
  options: string[];
};

export type FinalPreferenceQuestion = {
  id: string;
  label: string;
  options: string[];
};

export type StudyBlock = {
  id: string;
  partId: string;
  title: string;
  intro: string;
  taskInstruction: string;
  onboarding: TutorialSection[];
  onboardingPreviewTrials?: Trial[];
  practiceTrials: Trial[];
  realTrials: Trial[];
  subjectiveSection: SubjectiveSection;
};

export type StudyPack = {
  title: string;
  responseEndpoint: string;
  consentText: string[];
  introText: string[];
  backgroundQuestions: BackgroundQuestion[];
  blocks: StudyBlock[];
  finalPreferenceQuestions: FinalPreferenceQuestion[];
  finalCommentPrompt: string;
};
