export type SRSMode = 'general' | 'fast' | 'medical';

export interface Folder {
  id: string;
  userId: string;
  name: string;
  parentId?: string | null;
  createdAt: any;
}

export interface Deck {
  id: string;
  userId: string;
  folderId?: string; // Legacy
  parentId?: string; // New: For nested decks
  title: string;
  description: string;
  cardCount: number;
  srsMode: SRSMode;
  lastCardNumber?: number;
  newCardsPerDay?: number;
  maxReviewsPerDay?: number;
  dailyProgress?: {
    date: string;
    newCardsStudied: number;
    reviewCardsStudied: number;
  };
  dueCounts?: {
    general: number;
    fast: number;
    medical: number;
  };
  createdAt: any;
  tags?: string[];
}

export interface SRSProgress {
  nextReview: any; // Date or Timestamp
  interval: number;
  easeFactor: number;
  repetitionCount: number;
  lastRating: number;
  learningStep?: number;
  status?: 'learning' | 'mastered' | 'new' | 'learned';
  passCount?: number;
  failCount?: number;
}

export interface Card {
  id: string;
  deckId: string;
  cardNumber?: number;
  front: string;
  back: string;
  // Progress is now per mode
  progress: {
    general?: SRSProgress;
    fast?: SRSProgress;
    medical?: SRSProgress;
  };
  // Keep the old root fields for backward compatibility/default
  nextReview: any;
  interval: number;
  easeFactor: number;
  repetitionCount: number;
  lastRating: number;
  createdAt: any;
}

export type SRSLevel = 0 | 1 | 2 | 3 | 4 | 5; // 0: Again, 1: Hard, 2: Good, 3: Easy
