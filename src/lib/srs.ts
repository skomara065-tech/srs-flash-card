/**
 * Spaced Repetition Algorithm (SM-2 variant)
 * Calculates the next review date and SRS parameters based on user rating.
 */

import { SRSMode } from "../types";

export interface SRSResult {
  nextReview: Date;
  interval: number;
  easeFactor: number;
  repetitionCount: number;
  learningStep?: number;
  status?: 'learning' | 'mastered' | 'new' | 'learned';
  passCount?: number;
  failCount?: number;
}

export function calculateSRS(
  rating: number, // 0-3 (Again, Hard, Good, Easy) for general/medical. For fast: 0 (Fail), 1 (Pass)
  previousInterval: number, // in minutes (or days internally as minutes)
  previousEaseFactor: number,
  previousRepetitionCount: number,
  mode: SRSMode = 'general',
  // Extra states
  learningStep: number = 0,
  status: 'learning' | 'mastered' | 'new' | 'learned' = 'learning',
  passCount: number = 0,
  failCount: number = 0
): SRSResult {
  let interval = previousInterval;
  let easeFactor = previousEaseFactor;
  let repetitionCount = previousRepetitionCount;
  let nextStep = learningStep;
  let nextStatus = status;
  let nextPass = passCount;
  let nextFail = failCount;

  const MIN_1 = 1;
  const MIN_15 = 15;
  const DAY_1 = 1440;
  const MAX_INTERVAL = 1000 * 1440;

  if (mode === 'fast') {
    // rating: 0 = fail, 1 = pass (we might map 2 to pass)
    const passed = rating >= 1; // Any positive rating implies pass

    if (passed) {
      nextPass += 1;
      if (nextPass >= 1) { // 1 pass marks as learned
        nextStatus = 'learned';
        nextPass = 0; // reset for next review
        // determine interval
        if (repetitionCount === 0) interval = DAY_1; // Review 1 -> 1 day
        else if (repetitionCount === 1) interval = 3 * DAY_1;
        else if (repetitionCount === 2) interval = 7 * DAY_1;
        else if (repetitionCount === 3) interval = 14 * DAY_1;
        else if (repetitionCount === 4) interval = 30 * DAY_1;
        else if (repetitionCount === 5) interval = 60 * DAY_1;
        else {
          nextStatus = 'mastered';
          interval = 1000 * DAY_1; // mastered
        }
        repetitionCount++;
      }
    } else {
      nextFail += 1;
      nextPass = 0;
      nextStatus = 'new';
      repetitionCount = 0; // Reset to Review 1 schedule
      interval = 0; // No delay, it's a new card
    }

  } else if (mode === 'general') {
    if (status !== 'mastered') { // Learning Phase
      const steps = [MIN_1, MIN_15];
      
      if (rating === 0) { // Again
        nextStep = 0;
        interval = steps[0];
      } else if (rating === 2) { // Good
        if (nextStep + 1 < steps.length) {
          nextStep++;
          interval = steps[nextStep];
        } else {
          // Graduate
          nextStatus = 'mastered';
          interval = DAY_1;
          repetitionCount = 1;
        }
      } else if (rating === 3 || rating === 1) { // Easy (or Hard acts like Good/Easy)
        // Hard isn't standard in learning phase but we'll map Easy
        if (rating === 3) {
          nextStatus = 'mastered';
          interval = 4 * DAY_1;
          repetitionCount = 1;
        } else {
          // Map Hard to Again
          nextStep = 0;
          interval = steps[0];
        }
      }
    } else { // Mastered Phase
      if (rating === 0) { // Again
        nextStatus = 'learning';
        nextStep = 0;
        interval = MIN_1;
        easeFactor -= 0.20;
        repetitionCount = 0;
      } else if (rating === 1) { // Hard
        interval = Math.round(interval * 1.2);
        easeFactor -= 0.15;
      } else if (rating === 2) { // Good
        interval = Math.round(interval * easeFactor);
        easeFactor += 0; // unmodified
      } else if (rating === 3) { // Easy
        interval = Math.round(interval * easeFactor * 1.30);
        easeFactor += 0.15;
      }
    }
  } else if (mode === 'medical') {
    if (status !== 'mastered') { // Learning Phase
      const steps = [12 * 60, DAY_1]; // 12 hours, 1 day
      
      if (rating === 0 || rating === 1) { // Again (or Hard, since Hard isn't defined, treat as Again)
        nextStep = 0;
        interval = steps[0];
      } else if (rating === 2) { // Good
        if (nextStep + 1 < steps.length) {
          nextStep++;
          interval = steps[nextStep];
        } else {
          // Graduate to Mastered
          nextStatus = 'mastered';
          interval = DAY_1; // Initial interval when mastered is based on last step which is 1 day. Let's use 1 day or what was last? Prompt says "After each review, set due_date. During mastered phase, intervals are in days." We'll just advance to 1 day if graduating from Good, WAIT: actually if they just pressed GOOD inside learning step 2 (which is 1 day), the interval is 1 day.
          repetitionCount = 1;
        }
      } else if (rating === 3) { // Easy
        nextStatus = 'mastered';
        interval = 4 * DAY_1; // Arbitrary graduation interval for Easy, let's say 4 days like general, or maybe just 1 day? The prompt says "EASY -> graduate immediately", let's use 4 days or just DAY_1 * easeFactor. I'll use 4 days same as general, wait, prompt doesn't specify. Let's use 4 days.
        repetitionCount = 1;
      }
    } else { // Mastered Phase
      if (rating === 0) { // Again
        nextStatus = 'learning';
        nextStep = 0;
        interval = 12 * 60; // 12 hours
        easeFactor -= 0.20;
        repetitionCount = 0;
      } else if (rating === 1) { // Hard
        interval = Math.round(interval * 1.2);
        easeFactor -= 0.15;
      } else if (rating === 2) { // Good
        interval = Math.round(interval * easeFactor);
        easeFactor += 0;
      } else if (rating === 3) { // Easy
        interval = Math.round(interval * easeFactor * 1.30);
        easeFactor += 0.15;
      }
    }
  }

  // Common bounds
  if (easeFactor < 1.3) easeFactor = 1.3;
  if (interval > MAX_INTERVAL) interval = MAX_INTERVAL;
  if (interval >= DAY_1) {
    // Round to nearest whole day
    interval = Math.round(interval / DAY_1) * DAY_1;
  }

  const nextReview = new Date();
  nextReview.setMinutes(nextReview.getMinutes() + interval);

  return {
    nextReview,
    interval,
    easeFactor,
    repetitionCount,
    learningStep: nextStep,
    status: nextStatus,
    passCount: nextPass,
    failCount: nextFail
  };
}

export function formatInterval(minutes: number): string {
  if (minutes < 1) return "< 1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  
  const months = days / 30;
  if (months < 12) return `${Math.round(months)}mo`;
  
  const years = days / 365;
  return `${years.toFixed(1)}y`;
}

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins <= 0) return "Due now";
  
  if (diffMins < 60) return `In ${diffMins}m`;
  
  const hours = diffMins / 60;
  if (hours < 24) return `In ${Math.round(hours)}h`;
  
  const days = hours / 24;
  if (days < 30) return `In ${Math.round(days)}d`;
  
  const months = days / 30;
  return `In ${Math.round(months)}mo`;
}
