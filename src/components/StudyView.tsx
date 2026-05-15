import * as React from "react";
import { useState, useEffect } from "react";
import { collection, query, where, getDocs, getDoc, getDocsFromServer, updateDoc, doc, serverTimestamp, orderBy, limit, writeBatch, increment, startAfter, DocumentSnapshot } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { Deck, Card, SRSLevel } from "../types";
import { calculateSRS, formatInterval } from "../lib/srs";
import { ArrowLeft, Check, X, RotateCcw, Sparkles, LogOut, Save } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface StudyViewProps {
  deck: Deck;
  allDecks: Deck[];
  onBack: () => void;
  forceRefresh?: boolean;
}

export function StudyView({ deck, allDecks, onBack, forceRefresh }: StudyViewProps) {
  const [cards, setCards] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const sessionProgressRef = React.useRef({
    newStudied: 0,
    reviewStudied: 0,
    initialized: false
  });

  useEffect(() => {
    fetchCards(forceRefresh);
  }, [forceRefresh]);

  const getDeckAndDescendantIds = React.useCallback((deckId: string): string[] => {
    const ids = [deckId];
    const getChildren = (id: string) => {
      const children = allDecks.filter(d => (d.parentId || d.folderId) === id);
      for (const child of children) {
        ids.push(child.id);
        getChildren(child.id);
      }
    };
    getChildren(deckId);
    return ids;
  }, [allDecks]);

  const fetchCards = async (passedForceRefresh?: boolean, isNextBatch = false) => {
    try {
      if (!isNextBatch) {
        setLoading(true);
      }
      
      const today = new Date().toISOString().split('T')[0];
      if (!sessionProgressRef.current.initialized) {
        sessionProgressRef.current = {
          newStudied: deck.dailyProgress?.date === today ? deck.dailyProgress.newCardsStudied : 0,
          reviewStudied: deck.dailyProgress?.date === today ? deck.dailyProgress.reviewCardsStudied : 0,
          initialized: true
        };
      }

      const newLimit = deck.newCardsPerDay ?? Infinity;
      const revLimit = deck.maxReviewsPerDay ?? Infinity;
      
      const remainingNew = Math.max(0, newLimit - sessionProgressRef.current.newStudied);
      const remainingRev = Math.max(0, revLimit - sessionProgressRef.current.reviewStudied);

      if (remainingNew <= 0 && remainingRev <= 0) {
         setCards([]);
         if (isNextBatch) {
           setCurrentIndex(0);
           setBatchLoading(false);
           setSessionComplete(true);
         }
         return;
      }

      const modePath = `progress.${deck.srsMode}.nextReview`;
      let fetchedCards: Card[] = [];
      const ids = getDeckAndDescendantIds(deck.id);

      // Fetch New Cards
      if (remainingNew > 0) {
        const promises = ids.map(id => {
          const qNew = query(
            collection(db, "decks", id, "cards"),
            where(modePath, "<", new Date('2010-01-01')),
            orderBy(modePath),
            limit(Math.min(20, remainingNew))
          );
          return passedForceRefresh && !isNextBatch ? getDocsFromServer(qNew) : getDocs(qNew);
        });
        const snapshots = await Promise.all(promises);
        const newCardsRaw = snapshots.flatMap(s => s.docs);
        const slicedNew = newCardsRaw.slice(0, remainingNew);
        fetchedCards.push(...slicedNew.map(docSnap => parseCardData(docSnap.id, docSnap.data())));
      }

      // Fetch Review Cards
      if (remainingRev > 0 && fetchedCards.length < 30) {
        const remainingToFetch = Math.min(30 - fetchedCards.length, remainingRev);
        const promises = ids.map(id => {
          const qRev = query(
            collection(db, "decks", id, "cards"),
            where(modePath, ">=", new Date('2010-01-01')),
            where(modePath, "<=", new Date()),
            orderBy(modePath),
            limit(remainingToFetch)
          );
          return passedForceRefresh && !isNextBatch ? getDocsFromServer(qRev) : getDocs(qRev);
        });
        const snapshots = await Promise.all(promises);
        const revCardsRaw = snapshots.flatMap(s => s.docs);
        
        // Sort review cards across descendants
        revCardsRaw.sort((a, b) => {
           let aNext = a.data().progress?.[deck.srsMode]?.nextReview || a.data().nextReview;
           let bNext = b.data().progress?.[deck.srsMode]?.nextReview || b.data().nextReview;
           aNext = aNext?.toDate ? aNext.toDate() : (aNext instanceof Date ? aNext : new Date(aNext?.seconds ? aNext.seconds * 1000 : aNext));
           bNext = bNext?.toDate ? bNext.toDate() : (bNext instanceof Date ? bNext : new Date(bNext?.seconds ? bNext.seconds * 1000 : bNext));
           return aNext.getTime() - bNext.getTime();
        });

        const slicedRev = revCardsRaw.slice(0, remainingToFetch);
        fetchedCards.push(...slicedRev.map(docSnap => parseCardData(docSnap.id, docSnap.data())));
      }

      setCards(fetchedCards);
      
      if (isNextBatch) {
        setCurrentIndex(0);
        setBatchLoading(false);
        if (fetchedCards.length === 0) {
          setSessionComplete(true);
        }
      }
    } catch (err) {
      console.error("Error fetching study cards:", err);
      if (isNextBatch) setBatchLoading(false);
    } finally {
      if (!isNextBatch) setLoading(false);
    }
  };

  const parseCardData = (id: string, data: any): Card => {
        const modeProgress = data.progress?.[deck.srsMode];
        
        // Fix for corrupted reset cards that retained 'mastered' status with 0 interval
        if (modeProgress?.status === 'mastered' && (modeProgress?.interval === 0 || modeProgress?.interval === undefined)) {
           modeProgress.status = 'learning';
           modeProgress.learningStep = 0;
        }

        let nextReview: Date;
        const rawNextReview = modeProgress?.nextReview || data.nextReview;

        if (rawNextReview?.toDate) {
          nextReview = rawNextReview.toDate();
        } else if (rawNextReview instanceof Date) {
          nextReview = rawNextReview;
        } else {
          nextReview = new Date(rawNextReview?.seconds ? rawNextReview.seconds * 1000 : rawNextReview);
        }

        if (isNaN(nextReview.getTime())) {
          nextReview = new Date();
        }

        return { 
          id, 
          ...data,
          interval: modeProgress?.interval ?? data.interval ?? 0,
          easeFactor: modeProgress?.easeFactor ?? data.easeFactor ?? 2.5,
          repetitionCount: modeProgress?.repetitionCount ?? data.repetitionCount ?? 0,
          lastRating: modeProgress?.lastRating ?? data.lastRating ?? 0,
          nextReview
        } as Card;
  };

  const flushUpdates = async (updatesToFlush: Record<string, any> = pendingUpdates) => {
    const updateCount = Object.keys(updatesToFlush).length;
    if (updateCount === 0) return;

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      let numNewlyDue = 0;
      let numNoLongerDue = 0;
      const now = new Date();
      
      let newStudiedCount = 0;
      let reviewStudiedCount = 0;

      Object.entries(updatesToFlush).forEach(([cardId, updateData]) => {
        const cardRef = doc(db, "decks", deck.id, "cards", cardId);
        batch.update(cardRef, updateData);
        
        const card = cards.find(c => c.id === cardId);
        
        if (card) {
           if (card.repetitionCount === 0) newStudiedCount++;
           else reviewStudiedCount++;
        }

        const oldNextReview = card?.nextReview instanceof Date ? card.nextReview : (card?.nextReview?.toDate ? card.nextReview.toDate() : new Date());
        const wasDue = oldNextReview <= now || card?.repetitionCount === 0;

        const modeData = updateData[`progress.${deck.srsMode}`];
        if (modeData) {
          const newNextReview = modeData.nextReview;
          const isDue = newNextReview <= now;
          if (wasDue && !isDue) numNoLongerDue++;
          else if (!wasDue && isDue) numNewlyDue++;
        }
      });
      
      // Update session local reference
      sessionProgressRef.current.newStudied += newStudiedCount;
      sessionProgressRef.current.reviewStudied += reviewStudiedCount;

      const deckRef = doc(db, "decks", deck.id);
      
      // We will read the deck document to perform our complex atomic update 
      // of `dailyProgress`.
      
      // In a real app we might use a runTransaction here, but a basic check-and-update 
      // works well enough since the user is studying sequentially.
      await batch.commit();

      const today = Math.max(0, new Date().toISOString().split('T')[0] as any) as any; // hack to avoid unused
      
      const delta = numNewlyDue - numNoLongerDue;
      
      const deckUpdatePayload: any = {};
      if (delta !== 0) {
         deckUpdatePayload[`dueCounts.${deck.srsMode}`] = increment(delta);
      }
      
      if (newStudiedCount > 0 || reviewStudiedCount > 0) {
         // get fresh data to incrementally update daily progress
         const deckSnap = await getDoc(deckRef);
         if (deckSnap.exists()) {
           const freshDeck = deckSnap.data() as Deck;
           const targetDate = new Date().toISOString().split('T')[0];
           
           if (freshDeck.dailyProgress?.date === targetDate) {
              deckUpdatePayload['dailyProgress.newCardsStudied'] = increment(newStudiedCount);
              deckUpdatePayload['dailyProgress.reviewCardsStudied'] = increment(reviewStudiedCount);
           } else {
              deckUpdatePayload['dailyProgress'] = {
                 date: targetDate,
                 newCardsStudied: newStudiedCount,
                 reviewCardsStudied: reviewStudiedCount
              };
           }
         }
      }

      if (Object.keys(deckUpdatePayload).length > 0) {
         await updateDoc(deckRef, deckUpdatePayload);
      }

      setPendingUpdates({});
    } catch (err) {
      console.error("Failed to batch update cards:", err);
      handleFirestoreError(err, OperationType.UPDATE, `decks/${deck.id}/cards/multiple`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAndExit = async () => {
    await flushUpdates();
    onBack();
  };

  const handleRating = async (rating: number) => {
    const card = cards[currentIndex];
    const srsData = calculateSRS(
      rating, 
      card.interval, 
      card.easeFactor, 
      card.repetitionCount,
      deck.srsMode,
      card.progress?.[deck.srsMode]?.learningStep,
      card.progress?.[deck.srsMode]?.status,
      card.progress?.[deck.srsMode]?.passCount,
      card.progress?.[deck.srsMode]?.failCount
    );

    // Queue update locally
    const updateData: any = {
      [`progress.${deck.srsMode}`]: {
        ...srsData,
        lastRating: rating,
      },
      updatedAt: serverTimestamp(),
    };

    // Handle immediate re-review logic
    let shouldLoop = rating === 0;
    if (deck.srsMode === 'fast' || deck.srsMode === 'medical') {
      shouldLoop = false;
    }

    if (shouldLoop) {
      // Create a updated copy for the next review in this session
      const updatedCard = { 
        ...card, 
        ...srsData,
        progress: {
          ...card.progress,
          [deck.srsMode]: {
            ...(card.progress?.[deck.srsMode] || {}),
            ...srsData
          }
        }
      };
      setCards(prev => [...prev, updatedCard]);
    }

    setPendingUpdates(prev => {
      const next = { ...prev, [card.id]: updateData };
      
      if (currentIndex < cards.length - 1 || shouldLoop) {
        setIsFlipped(false);
        setCurrentIndex(v => v + 1);
      } else {
        // End of batch
        setIsFlipped(false);
        setBatchLoading(true);
        flushUpdates(next).then(() => {
          fetchCards(false, true);
        });
      }
      return next;
    });
  };

  const currentCard = cards[currentIndex];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Sparkles className="animate-spin text-neutral-300" />
      </div>
    );
  }

  if (batchLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <Sparkles className="animate-spin text-neutral-300 w-8 h-8" />
        <p className="text-neutral-500 font-medium">Batch saved — loading more cards...</p>
      </div>
    );
  }

  if (sessionComplete || (cards.length === 0 && !loading)) {
    const hasUnsavedChanges = Object.keys(pendingUpdates).length > 0;

    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-xl mx-auto text-center py-16 px-8 bg-white rounded-[3rem] border-2 border-neutral-100 shadow-2xl space-y-8"
      >
        <div className="relative inline-block">
          <div className="w-24 h-24 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-inner relative z-10">
            {isSaving ? <RotateCcw size={48} className="animate-spin" /> : <Check size={48} />}
          </div>
          <motion.div 
            animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
            transition={{ repeat: Infinity, duration: 4 }}
            className="absolute -top-2 -right-2 w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center text-yellow-600 shadow-sm z-20"
          >
            <Sparkles size={20} />
          </motion.div>
        </div>

        <div className="space-y-3">
          <h2 className="text-4xl font-bold tracking-tight text-neutral-900">
            {isSaving ? "Syncing..." : "Session Complete!"}
          </h2>
          <p className="text-lg text-neutral-500 max-w-sm mx-auto leading-relaxed">
            {isSaving 
              ? "We're committing your progress to the cloud. Don't close this tab." 
              : hasUnsavedChanges 
                ? `You've rated ${Object.keys(pendingUpdates).length} cards. Ready to save your hard work?`
                : "You've finished your review for this session."}
          </p>
        </div>

        <div className="pt-4">
          <button 
            onClick={handleSaveAndExit}
            disabled={isSaving}
            className="w-full group relative flex flex-col items-center justify-center gap-2 px-8 py-8 bg-black text-white rounded-[2.5rem] font-bold uppercase tracking-[0.1em] hover:bg-neutral-800 transition-all active:scale-[0.98] disabled:opacity-50 shadow-[0_12px_40px_rgba(0,0,0,0.2)]"
          >
            <div className="flex items-center gap-3 text-xl">
              {isSaving ? <RotateCcw size={28} className="animate-spin" /> : <Save size={28} />}
              <span>{hasUnsavedChanges ? "Save & Finish" : "Finish Session"}</span>
            </div>
            <span className="text-[10px] opacity-50 font-medium tracking-[0.2em]">Commits all progress to database</span>
            
            {/* Visual glow effect on hover */}
            <div className="absolute inset-0 rounded-[2.5rem] bg-white opacity-0 group-hover:opacity-5 transition-opacity" />
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-6 pb-2">
        <div className="flex items-center gap-4 flex-1">
          <div className="h-2.5 flex-1 bg-neutral-200 rounded-full overflow-hidden shadow-inner">
            <motion.div 
              className="h-full bg-black shadow-[0_0_10px_rgba(0,0,0,0.1)]"
              initial={{ width: 0 }}
              animate={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-neutral-400 whitespace-nowrap bg-white px-2 py-1 rounded-lg border border-neutral-100 shadow-sm">{currentIndex + 1} / {cards.length}</span>
        </div>
      </div>

      <div className="perspective-1000 relative">
        <AnimatePresence>
          {isSaving && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 bg-white/60 backdrop-blur-[2px] rounded-[2.5rem] flex flex-col items-center justify-center gap-3"
            >
              <RotateCcw className="animate-spin text-black" size={32} />
              <span className="text-xs font-bold uppercase tracking-widest text-black">Syncing...</span>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div 
          onClick={() => !isFlipped && setIsFlipped(true)}
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          style={{ transformStyle: "preserve-3d" }}
          className="relative w-full aspect-[4/3] cursor-pointer"
        >
          {/* Front */}
          <div className="absolute inset-0 backface-hidden bg-white border border-neutral-200 rounded-[2.5rem] p-12 flex flex-col items-center justify-center text-center shadow-sm">
            <span className="absolute top-8 left-12 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Question</span>
            <h3 className="text-2xl md:text-3xl font-sans tracking-tight leading-relaxed">{currentCard.front}</h3>
            <p className="absolute bottom-8 text-xs text-neutral-400 animate-pulse font-medium">Click to reveal answer</p>
          </div>

          {/* Back */}
          <div 
            style={{ transform: "rotateY(180deg)" }}
            className="absolute inset-0 backface-hidden bg-neutral-900 border border-neutral-800 rounded-[2.5rem] p-12 flex flex-col items-center justify-center text-center shadow-xl"
          >
            <span className="absolute top-8 left-12 text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Answer</span>
            <h3 className="text-2xl md:text-3xl font-sans tracking-tight leading-relaxed text-white">{currentCard.back}</h3>
          </div>
        </motion.div>
      </div>

      <div className="h-24">
        <AnimatePresence mode="wait">
          {isFlipped && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`grid gap-3 md:gap-4 ${deck.srsMode === 'fast' ? 'grid-cols-2' : 'grid-cols-4'}`}
            >
              {deck.srsMode === 'fast' ? (
                [ // Fast review buttons
                  { r: 0, l: "Didn't Get It", c: "bg-red-50 text-red-600 border-red-100 hover:bg-red-100" },
                  { r: 1, l: "Got It", c: "bg-green-50 text-green-600 border-green-100 hover:bg-green-100" }
                ].map(btn => {
                  const preview = calculateSRS(
                    btn.r, 
                    currentCard.interval, 
                    currentCard.easeFactor, 
                    currentCard.repetitionCount,
                    deck.srsMode,
                    currentCard.progress?.[deck.srsMode]?.learningStep,
                    currentCard.progress?.[deck.srsMode]?.status,
                    currentCard.progress?.[deck.srsMode]?.passCount,
                    currentCard.progress?.[deck.srsMode]?.failCount
                  );
                  return (
                    <RatingButton 
                      key={btn.r}
                      onClick={() => handleRating(btn.r)} 
                      label={btn.l} 
                      sublabel={formatInterval(preview.interval)}
                      color={btn.c} 
                    />
                  );
                })
              ) : (
                [ // General / Medical modes
                  { r: 0, l: "Again", c: "bg-red-50 text-red-600 border-red-100 hover:bg-red-100" },
                  { r: 1, l: "Hard", c: "bg-orange-50 text-orange-600 border-orange-100 hover:bg-orange-100" },
                  { r: 2, l: "Good", c: "bg-green-50 text-green-600 border-green-100 hover:bg-green-100" },
                  { r: 3, l: "Easy", c: "bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100" }
                ].map(btn => {
                  const preview = calculateSRS(
                    btn.r, 
                    currentCard.interval, 
                    currentCard.easeFactor, 
                    currentCard.repetitionCount,
                    deck.srsMode,
                    currentCard.progress?.[deck.srsMode]?.learningStep,
                    currentCard.progress?.[deck.srsMode]?.status,
                    currentCard.progress?.[deck.srsMode]?.passCount,
                    currentCard.progress?.[deck.srsMode]?.failCount
                  );
                  return (
                    <RatingButton 
                      key={btn.r}
                      onClick={() => handleRating(btn.r)} 
                      label={btn.l} 
                      sublabel={formatInterval(preview.interval)}
                      color={btn.c} 
                    />
                  );
                })
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex justify-center pt-8 border-t border-neutral-100">
        <button 
          onClick={handleSaveAndExit}
          disabled={isSaving}
          className="flex items-center gap-3 px-10 py-5 bg-white border-2 border-neutral-900 rounded-3xl text-sm font-bold uppercase tracking-[0.1em] hover:bg-neutral-900 hover:text-white transition-all disabled:opacity-30 shadow-[0_4px_0_0_rgba(0,0,0,1)] active:translate-y-[2px] active:shadow-[0_2px_0_0_rgba(0,0,0,1)] transform"
        >
          {isSaving ? <RotateCcw size={18} className="animate-spin" /> : <LogOut size={18} />}
          <span>Save progress & Exit Study</span>
        </button>
      </div>
    </div>
  );
}

interface RatingButtonProps {
  onClick: () => void | Promise<void>;
  label: string;
  sublabel: string;
  color: string;
}

const RatingButton: React.FC<RatingButtonProps> = ({ onClick, label, sublabel, color }) => {
  return (
    <button 
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-1 py-4 md:py-6 rounded-2xl border font-semibold transition-all active:scale-95 shadow-sm ${color}`}
    >
      <span className="text-xs uppercase tracking-wider opacity-60 font-bold">{sublabel}</span>
      <span className="text-sm md:text-base">{label}</span>
    </button>
  );
}
