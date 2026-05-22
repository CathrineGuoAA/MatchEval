
export enum Role {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

export interface Comment {
  id: string;
  text: string;
  timestamp: number;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  isHighlighted?: boolean;
  highlightColor?: 'green' | 'red' | 'yellow' | 'none';
  comments: Comment[];
}

export interface Metric {
  name: string;
  score: number; // 0-10
  reasoning: string;
}

export interface FactCheckSource {
  uri: string;
  title: string;
}

export interface EvaluationResult {
  overallScore: number;
  summary: string;
  metrics: Metric[];
  suggestedImprovements?: string;
  timestamp: number;
  factCheckReport?: string;
  factCheckSources?: FactCheckSource[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  evaluation?: EvaluationResult;
  referenceContext?: string; // Ground truth / Ideal answer
  domainContext?: string; // Knowledge base / System prompt context
  createdAt: number;
  category?: ConversationCategory;
}

export interface Criteria {
  id: string;
  name: string;
  description: string;
}

export type ViewState = 'dashboard' | 'editor' | 'settings';

export type ConversationCategory = 'Normal' | 'Edge Case' | 'Multilingual' | 'Sensitive' | 'Uncategorized';
