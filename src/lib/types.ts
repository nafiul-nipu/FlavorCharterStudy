export type MeansByTaste = Record<string, number>;
export type StdevsByTaste = Record<string, number>;
export type OutliersByTaste = Record<string, number[]>;
export type DistributionByTaste = Record<
  string,
  Record<string, { count: number; percent: number }>
>;

export type ChartType =
  | "distribution_radar"
  | "histogram_small_multiples"
  | "stacked_bar_distribution"
  | "zchart"
  | "dual_histogram";

export type TaskType =
  | "distribution_agreement"
  | "dominant_profile_similarity"
  | "spatial_profile_comparison"
  | "distribution_comparison"
  | "difference_size"
  | "tutorial_preview";

export type AnswerMode =
  | "single_choice_tuple"
  | "multi_select_indices"
  | "binary_choice"
  | "none";

export type Difficulty = "easy" | "medium" | "hard";

export type Footprint = {
  width: number;
  height: number;
  approximateArea: number;
};

export type SingleFoodStimulus = {
  stimulusId: string;
  stimulusKind: "single_food";
  foodName: string;
  foodNames: string[];
  count: number;
  senses: Record<string, string>;
  valueRange: { min: number; max: number };
  meanValues: MeansByTaste;
  stdevs: StdevsByTaste;
  distribution: DistributionByTaste;
};

export type FoodPanel = {
  index: number;
  foodName: string;
  count: number;
  meanValues: MeansByTaste;
  stdevs: StdevsByTaste;
  distribution: DistributionByTaste;
};

export type MultiFoodStimulus = {
  stimulusId: string;
  stimulusKind: "multi_food";
  foodName: string;
  foodNames: string[];
  senses: Record<string, string>;
  valueRange: { min: number; max: number };
  targetProfileKeys: string[];
  targetProfileLabels: string[];
  foods: FoodPanel[];
};

export type PopulationComparisonStimulus = {
  stimulusId: string;
  stimulusKind: "population_comparison";
  foodName: string;
  foodNames: string[];
  comparisonLabel: string;
  populationA: {
    id: string;
    label: string;
    count: number;
    meanValues: MeansByTaste;
    stdevs: StdevsByTaste;
    distribution: DistributionByTaste;
  };
  populationB: {
    id: string;
    label: string;
    count: number;
    meanValues: MeansByTaste;
    stdevs: StdevsByTaste;
    distribution: DistributionByTaste;
  };
  senses: Record<string, string>;
  valueRange: { min: number; max: number };
};

export type TrialStimulus =
  | SingleFoodStimulus
  | MultiFoodStimulus
  | PopulationComparisonStimulus;

export type Trial = {
  id: string;
  blockId: string;
  partId: string;
  kind: "practice" | "real" | "preview";
  chartType: ChartType;
  taskType: TaskType;
  answerMode: AnswerMode;
  difficulty?: Difficulty;
  clarityMargin?: number;
  prompt: string;
  options: string[];
  correctAnswer: string | string[];
  stimulus: TrialStimulus;
  developerNotes?: string[];
  footprint?: Footprint;
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
  subjectiveSection?: SubjectiveSection;
};

export type StudyMetadata = {
  chartFootprints: Record<ChartType, Footprint>;
  realTrialCount: number;
  practiceTrialCount: number;
  blockRealTrialCounts: Record<string, number>;
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
  metadata?: StudyMetadata;
};
