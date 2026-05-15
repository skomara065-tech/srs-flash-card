import * as React from "react";
import { useState, useEffect } from "react";
import { collection, query, getDocs, getDoc, getDocsFromServer, addDoc, serverTimestamp, deleteDoc, doc, orderBy, updateDoc, writeBatch, limit, startAfter, DocumentSnapshot, deleteField, getCountFromServer, where } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { Deck, Card, SRSMode } from "../types";
import { ArrowLeft, Plus, Trash2, BookOpen, Clock, Loader2, Sparkles, MessageSquarePlus, Zap, Stethoscope, Settings2, RotateCcw, Timer, MoreVertical, Edit2, ChevronDown, Search } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { formatRelativeTime } from "../lib/srs";

const DeckCardItem = React.memo(({ card, onEdit, onDelete }: { card: Card, onEdit: () => void, onDelete: () => void }) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const rawNextReview = card.nextReview;
  let nextReviewDate: Date;
  
  if (rawNextReview instanceof Date) {
    nextReviewDate = rawNextReview;
  } else if (rawNextReview && typeof rawNextReview === 'object' && 'toDate' in rawNextReview && typeof rawNextReview.toDate === 'function') {
    nextReviewDate = rawNextReview.toDate();
  } else {
    nextReviewDate = new Date(rawNextReview?.seconds ? rawNextReview.seconds * 1000 : rawNextReview);
  }

  if (isNaN(nextReviewDate.getTime())) {
    nextReviewDate = new Date();
  }

  const isDue = nextReviewDate <= new Date();
  const isNew = card.repetitionCount === 0;
  const highlight = isDue || isNew;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group border px-4 py-3 sm:px-5 sm:py-4 flex flex-col transition-all shadow-sm relative overflow-visible ${
        highlight 
          ? "bg-white border-neutral-200 hover:border-black rounded-xl sm:rounded-2xl" 
          : "bg-neutral-50/50 border-neutral-200 hover:border-black transition-all rounded-xl sm:rounded-2xl"
      }`}
    >
      <div className="flex w-full justify-between items-center mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {isNew ? (
            <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-mono text-amber-500 font-bold bg-amber-50 px-2 py-0.5 rounded-full">
              <Sparkles size={12} />
              Not studied
            </div>
          ) : isDue ? (
            <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-mono text-orange-500 font-bold bg-orange-50 px-2 py-0.5 rounded-full">
              <Clock size={12} />
              Not quite
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-mono text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded-full">
              <div className="w-2 h-2 rounded outline outline-1 outline-offset-1 outline-green-600 bg-green-600"></div>
              Got it
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 relative z-10" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
            className="p-1 rounded-md hover:bg-neutral-200 text-neutral-400 hover:text-black transition-colors"
          >
            <MoreVertical size={18} />
          </button>
          <AnimatePresence>
            {showMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute right-0 top-8 bg-white rounded-xl shadow-xl border border-neutral-200 overflow-hidden w-36 z-50 origin-top-right"
              >
                <button 
                  onClick={(e) => { e.stopPropagation(); setShowMenu(false); onEdit(); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-neutral-50 text-neutral-700"
                >
                  <Edit2 size={14} /> Edit
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete(); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-red-50 text-red-600"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      
      <div className="flex flex-col text-left">
        <p className={`text-[14px] sm:text-[15px] font-medium leading-relaxed ${highlight ? "text-neutral-900" : "text-neutral-700"} mb-1`}>
          <span className="font-bold mr-1">Q:</span>
          {card.front}
        </p>
        <p className={`text-[13px] sm:text-[14px] leading-relaxed ${highlight ? "text-neutral-600" : "text-neutral-500"} line-clamp-3 sm:line-clamp-none`}>
          <span className="font-bold mr-1">A:</span>
          {card.back}
        </p>
      </div>
    </motion.div>
  );
});

interface DeckDetailProps {
  deck: Deck;
  allDecks: Deck[];
  onBack: () => void;
  onStudy: () => void;
  onUpdateDeck: (deck: Partial<Deck>) => void;
  forceRefresh?: boolean;
  onReset?: () => void;
  isAdmin?: boolean;
}

export function DeckDetail({ deck, allDecks, onBack, onStudy, onUpdateDeck, forceRefresh, onReset, isAdmin }: DeckDetailProps) {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const lastVisible = React.useRef<DocumentSnapshot | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<'all' | 'new' | 'due' | 'next'>('all');
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [deleteCardConfirm, setDeleteCardConfirm] = useState<Card | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [showModeMenu, setShowModeMenu] = useState(false);
  const modeMenuRef = React.useRef<HTMLDivElement>(null);
  
  const [dashboardCounts, setDashboardCounts] = useState<{ newCount: number, reviewCount: number, loading: boolean }>({ newCount: 0, reviewCount: 0, loading: true });

  const [limitCount, setLimitCount] = useState(50);

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

  const fetchDashboardCounts = async () => {
    try {
      const modePath = `progress.${deck.srsMode}.nextReview`;
      const ids = getDeckAndDescendantIds(deck.id);
      let newTotal = 0;
      let revTotal = 0;
      
      const promises = ids.flatMap(id => {
        const qNew = query(
          collection(db, "decks", id, "cards"),
          where(modePath, "<", new Date('2010-01-01'))
        );
        const qRev = query(
          collection(db, "decks", id, "cards"),
          where(modePath, ">=", new Date('2010-01-01')),
          where(modePath, "<=", new Date())
        );
        return [
          getCountFromServer(qNew).then(s => { newTotal += s.data().count; }),
          getCountFromServer(qRev).then(s => { revTotal += s.data().count; })
        ];
      });
      await Promise.all(promises);
      
      setDashboardCounts({
        newCount: newTotal,
        reviewCount: revTotal,
        loading: false
      });
    } catch (err) {
      console.error("Failed to fetch dashboard counts:", err);
      setDashboardCounts(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setShowModeMenu(false);
      }
    };
    if (showModeMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModeMenu]);

  useEffect(() => {
    fetchCards(forceRefresh);
    fetchDashboardCounts();
  }, [deck.id, deck.srsMode, forceRefresh, allDecks]);

  const handleModeChange = async (mode: SRSMode) => {
    setShowModeMenu(false);
    if (mode === deck.srsMode) return;
    try {
      await updateDoc(doc(db, "decks", deck.id), {
        srsMode: mode,
        updatedAt: serverTimestamp()
      });
      onUpdateDeck({ srsMode: mode });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `decks/${deck.id}`);
    }
  };

  const fetchCards = async (passedForceRefresh?: boolean, loadMore: boolean = false) => {
    let currentLimit = limitCount;
    if (loadMore) {
      setLoadingMore(true);
      currentLimit += 50;
      setLimitCount(currentLimit);
    } else {
      if (!cards.length) setLoading(true);
    }

    try {
      const ids = getDeckAndDescendantIds(deck.id);
      const promises = ids.map(id => {
        const q = query(
          collection(db, "decks", id, "cards"), 
          orderBy("nextReview", "asc"),
          limit(currentLimit)
        );
        return passedForceRefresh && !loadMore ? getDocsFromServer(q) : getDocs(q);
      });
      
      const snapshots = await Promise.all(promises);
      let allDocs = snapshots.flatMap(s => s.docs);
      
      // Sort manually since we merged from multiple collections
      allDocs.sort((a, b) => {
        const aModeProgress = a.data().progress?.[deck.srsMode];
        const bModeProgress = b.data().progress?.[deck.srsMode];
        
        let aNext = aModeProgress?.nextReview || a.data().nextReview;
        let bNext = bModeProgress?.nextReview || b.data().nextReview;
        
        aNext = aNext?.toDate ? aNext.toDate() : (aNext instanceof Date ? aNext : new Date(aNext?.seconds ? aNext.seconds * 1000 : aNext));
        bNext = bNext?.toDate ? bNext.toDate() : (bNext instanceof Date ? bNext : new Date(bNext?.seconds ? bNext.seconds * 1000 : bNext));
        
        return aNext.getTime() - bNext.getTime();
      });
      
      // Slicing to the limit across all fetched docs to keep UI bounded
      const slicedDocs = allDocs.slice(0, currentLimit);
      setHasMore(allDocs.length > currentLimit);

      const parsedCards = slicedDocs.map(docSnap => {
        const data = docSnap.data() as any;
        const modeProgress = data.progress?.[deck.srsMode];
        
        let nextReview: Date;
        const rawNextReview = modeProgress?.nextReview || data.nextReview;
        
        if (rawNextReview?.toDate) {
          nextReview = rawNextReview.toDate();
        } else if (rawNextReview instanceof Date) {
          nextReview = rawNextReview;
        } else {
          nextReview = new Date(rawNextReview?.seconds ? rawNextReview.seconds * 1000 : rawNextReview);
        }

        return { 
          id: docSnap.id, 
          ...data,
          interval: modeProgress?.interval ?? data.interval ?? 0,
          easeFactor: modeProgress?.easeFactor ?? data.easeFactor ?? 2.5,
          repetitionCount: modeProgress?.repetitionCount ?? data.repetitionCount ?? 0,
          lastRating: modeProgress?.lastRating ?? data.lastRating ?? 0,
          nextReview: isNaN(nextReview.getTime()) ? new Date() : nextReview
        } as Card;
      });

      setCards(parsedCards);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFront.trim() || !newBack.trim()) return;

    setSaving(true);
    try {
      const initialProgress = {
        nextReview: new Date(1000), // Ensure it's due
        interval: 0,
        easeFactor: 2.5,
        repetitionCount: 0,
        lastRating: 0,
        status: 'learning',
        learningStep: 0,
        passCount: 0,
        failCount: 0,
      };

      const deckRef = doc(db, "decks", deck.id);
      const deckSnap = await getDoc(deckRef);
      const currentLastCardNumber = deckSnap.data()?.lastCardNumber || 0;
      const newCardNumber = currentLastCardNumber + 1;

      const cardRef = doc(collection(db, "decks", deck.id, "cards"));
      const batch = writeBatch(db);

      batch.set(cardRef, {
        deckId: deck.id,
        cardNumber: newCardNumber,
        front: newFront,
        back: newBack,
        // Root fields (legacy/summary)
        ...initialProgress,
        // Initialize all modes with fresh progress
        progress: {
          general: initialProgress,
          fast: initialProgress,
          medical: initialProgress
        },
        createdAt: serverTimestamp(),
      });

      batch.update(deckRef, {
        lastCardNumber: newCardNumber,
        updatedAt: serverTimestamp()
      });

      await batch.commit();

      // Update local state instead of fetching everything
      const newCard: Card = {
        id: cardRef.id,
        deckId: deck.id,
        cardNumber: newCardNumber,
        front: newFront,
        back: newBack,
        ...initialProgress,
        progress: {
          general: initialProgress,
          fast: initialProgress,
          medical: initialProgress
        },
        nextReview: initialProgress.nextReview,
        createdAt: new Date(),
      } as unknown as Card;

      setCards(prev => [newCard, ...prev]);
      setNewFront("");
      setNewBack("");
      setIsAdding(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `decks/${deck.id}/cards`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      await deleteDoc(doc(db, "decks", deck.id, "cards", cardId));
      setCards(cards.filter(c => c.id !== cardId));
      setDeleteCardConfirm(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `decks/${deck.id}/cards/${cardId}`);
    }
  };

  const handleUpdateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCard) return;

    setSaving(true);
    try {
      const cardRef = doc(db, "decks", deck.id, "cards", editingCard.id);
      await updateDoc(cardRef, {
        front: editFront,
        back: editBack,
        updatedAt: serverTimestamp()
      });

      setCards(cards.map(c => c.id === editingCard.id ? { ...c, front: editFront, back: editBack } : c));
      setEditingCard(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `decks/${deck.id}/cards/${editingCard.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResetProgress = async () => {
    setLoading(true);
    try {
      const longAgo = new Date("2000-01-01"); 
      const initialProgress = {
        nextReview: longAgo,
        interval: 0,
        easeFactor: 2.5,
        repetitionCount: 0,
        lastRating: 0,
        status: 'learning',
        learningStep: 0,
        passCount: 0,
        failCount: 0,
      };
      
      const q = query(collection(db, "decks", deck.id, "cards"), limit(500));
      const snapshot = await getDocs(q);
      const docs = snapshot.docs;
      
      console.log(`[RESET] Resetting ${docs.length} cards...`);
      
      if (docs.length === 0) {
        alert("This deck has no cards to reset.");
        setLoading(false);
        return;
      }

      // Firestore batch limit is 500
      for (let i = 0; i < docs.length; i += 500) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + 500);
        chunk.forEach(cardDoc => {
          // Use set with merge: true to ensure all fields are created/updated correctly
          batch.set(cardDoc.ref, {
            ...initialProgress,
            progress: {
              general: initialProgress,
              fast: initialProgress,
              medical: initialProgress
            },
            updatedAt: serverTimestamp(),
          }, { merge: true });
        });
        await batch.commit();
      }
      
      console.log(`[RESET] Successfully reset ${docs.length} cards.`);
      await fetchCards(true);
      onReset?.();
      alert(`Progress reset for ${docs.length} cards.`);
    } catch (err) {
      console.error("[RESET] Error:", err);
      alert("Failed to reset progress. Please try again.");
    } finally {
      setLoading(false);
    }
  };

    const hasDueCards = cards.some(c => {
      const nextReviewDate = c.nextReview instanceof Date ? c.nextReview : (c.nextReview?.toDate ? c.nextReview.toDate() : new Date(c.nextReview));
      return nextReviewDate <= new Date() || c.repetitionCount === 0;
    });

  const now = new Date();
  const filteredCards = cards.filter(c => {
    let matchesFilter = true;
    const nextReviewDate = c.nextReview instanceof Date ? c.nextReview : (c.nextReview?.toDate ? c.nextReview.toDate() : new Date(c.nextReview));
    const isNew = c.repetitionCount === 0;
    const isDue = nextReviewDate <= now;

    if (filter === 'new') matchesFilter = isNew;
    if (filter === 'due') matchesFilter = !isNew && isDue;
    if (filter === 'next') matchesFilter = !isNew && !isDue;

    if (!matchesFilter) return false;

    if (searchQuery.trim()) {
      const queryLower = searchQuery.toLowerCase();
      const cardNumberStr = c.cardNumber !== undefined ? c.cardNumber.toString().padStart(4, '0') : '';
      if (!c.front.toLowerCase().includes(queryLower) && !cardNumberStr.includes(queryLower)) {
        return false;
      }
    }

    return true;
  });

  return (
    <>
      <div className="space-y-8">
        {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-neutral-500 hover:text-black transition-colors">
          <ArrowLeft size={18} />
          <span className="font-medium">Back to Decks</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2.5 rounded-xl transition-all flex items-center gap-2 ${
                showSettings 
                  ? "bg-neutral-100 text-black shadow-inner" 
                  : "text-neutral-400 hover:text-black hover:bg-neutral-50"
              }`}
              title="Deck Settings"
            >
              <Settings2 size={20} />
            </button>

            <AnimatePresence>
              {showSettings && (
                <>
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setShowSettings(false)}
                    className="fixed inset-0 z-40"
                  />
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-64 bg-white border border-neutral-200 rounded-2xl shadow-xl z-50 overflow-hidden"
                  >
                    <div className="p-4 border-b border-neutral-50 space-y-4">
                      <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Deck Management</h4>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-neutral-500 uppercase">New Cards / Day</label>
                          <input 
                            type="number" 
                            min="0"
                            value={deck.newCardsPerDay ?? ""}
                            onChange={async (e) => {
                              const val = e.target.value === "" ? null : parseInt(e.target.value);
                              const updateObj = val === null ? { newCardsPerDay: deleteField() } : { newCardsPerDay: val };
                              try {
                                await updateDoc(doc(db, "decks", deck.id), updateObj);
                                onUpdateDeck({ newCardsPerDay: val === null ? undefined : val });
                              } catch (err) {
                                handleFirestoreError(err, OperationType.UPDATE, `decks/${deck.id}`);
                              }
                            }}
                            placeholder="Unlimited"
                            className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-black"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-neutral-500 uppercase">Max Reviews / Day</label>
                          <input 
                            type="number" 
                            min="0"
                            value={deck.maxReviewsPerDay ?? ""}
                            onChange={async (e) => {
                              const val = e.target.value === "" ? null : parseInt(e.target.value);
                              const updateObj = val === null ? { maxReviewsPerDay: deleteField() } : { maxReviewsPerDay: val };
                              try {
                                await updateDoc(doc(db, "decks", deck.id), updateObj);
                                onUpdateDeck({ maxReviewsPerDay: val === null ? undefined : val });
                              } catch (err) {
                                handleFirestoreError(err, OperationType.UPDATE, `decks/${deck.id}`);
                              }
                            }}
                            placeholder="Unlimited"
                            className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-black"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="p-2">
                      <button 
                        onClick={() => {
                          setShowSettings(false);
                          setResetConfirm(true);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-neutral-600 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all group"
                      >
                        <div className="p-1.5 rounded-lg bg-neutral-50 group-hover:bg-red-100 transition-colors">
                          <RotateCcw size={14} />
                        </div>
                        <div className="text-left">
                          <p className="font-medium">Reset Progress</p>
                          <p className="text-[10px] text-neutral-400 group-hover:text-red-400">Treat all cards as new</p>
                        </div>
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <button 
            onClick={onStudy}
            disabled={!hasDueCards}
            className="hidden md:flex bg-black text-white px-6 py-2.5 rounded-xl font-medium shadow-xl hover:bg-neutral-800 transition-all active:scale-[0.98] items-center gap-2 disabled:opacity-30 disabled:grayscale"
          >
            <BookOpen size={18} />
            Study Now
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-4xl font-medium tracking-tight">{deck.title}</h2>
          </div>
          
          <div className="flex flex-col items-start md:items-end gap-1.5">
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-[0.2em] px-1">Memory Algorithm</span>
            <div className="relative" ref={modeMenuRef}>
              <button 
                onClick={() => setShowModeMenu(!showModeMenu)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl text-sm font-bold uppercase tracking-tight shadow-sm border-2 transition-all ${
                  deck.srsMode === 'fast' ? "bg-orange-50 text-orange-600 border-orange-200 hover:border-orange-300" :
                  deck.srsMode === 'medical' ? "bg-indigo-50 text-indigo-600 border-indigo-200 hover:border-indigo-300" :
                  "bg-neutral-50 text-neutral-600 border-neutral-200 hover:border-neutral-300"
                }`}
              >
                <div className={`p-1.5 rounded-xl ${
                  deck.srsMode === 'fast' ? "bg-orange-100" :
                  deck.srsMode === 'medical' ? "bg-indigo-100" :
                  "bg-neutral-200"
                }`}>
                  {deck.srsMode === 'fast' ? <Zap size={16} fill="currentColor" /> : 
                   deck.srsMode === 'medical' ? <Stethoscope size={16} /> : 
                   <Settings2 size={16} />}
                </div>
                <span className="pr-1">{deck.srsMode || 'General'}</span>
              </button>

              {showModeMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-neutral-200 rounded-2xl shadow-xl overflow-hidden z-20">
                  <div className="p-2 space-y-1 text-sm font-medium">
                    <button 
                      onClick={() => handleModeChange('general')}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${deck.srsMode === 'general' ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'}`}
                    >
                      <Settings2 size={16} /> General
                    </button>
                    <button 
                      onClick={() => handleModeChange('fast')}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${deck.srsMode === 'fast' ? 'bg-orange-50 text-orange-600' : 'text-orange-500 hover:bg-orange-50'}`}
                    >
                      <Zap size={16} /> Fast
                    </button>
                    <button 
                      onClick={() => handleModeChange('medical')}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${deck.srsMode === 'medical' ? 'bg-indigo-50 text-indigo-600' : 'text-indigo-500 hover:bg-indigo-50'}`}
                    >
                      <Stethoscope size={16} /> Medical
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="text-neutral-500">{deck.description || "Manage your flashcards for this collection."}</p>
      </div>

      {/* Dashboard */}
      <div className="bg-white border md:border border-transparent md:border-neutral-200 md:rounded-3xl p-2 md:p-8 mb-4 md:mb-8 flex flex-col items-center justify-center">
        {dashboardCounts.loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={24} className="animate-spin text-neutral-400" />
          </div>
        ) : (
          (() => {
            const today = new Date().toISOString().split('T')[0];
            const studiedNew = deck.dailyProgress?.date === today ? deck.dailyProgress.newCardsStudied : 0;
            const studiedReview = deck.dailyProgress?.date === today ? deck.dailyProgress.reviewCardsStudied : 0;
          
            const newLimit = deck.newCardsPerDay ?? Infinity;
            const reviewLimit = deck.maxReviewsPerDay ?? Infinity;
          
            const newAvailable = Math.max(0, newLimit - studiedNew);
            const reviewAvailable = Math.max(0, reviewLimit - studiedReview);
          
            const displayNew = Math.min(dashboardCounts.newCount, newAvailable);
            const displayReview = Math.min(dashboardCounts.reviewCount, reviewAvailable);
            const displayTotal = displayNew + displayReview;

            return (
              <div className="space-y-4 md:space-y-6 w-full max-w-md text-center">
                <div>
                  <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-widest md:mb-2">cards to study</h3>
                  <div className="text-6xl md:text-[5rem] leading-none font-extrabold tracking-tight text-neutral-900 mt-2">{displayTotal}</div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-2 gap-4 md:pt-6 pt-4 border-t border-neutral-100">
                  {deck.srsMode === 'fast' ? (
                    <>
                      <div>
                        <div className="text-2xl font-bold text-neutral-800">{displayReview}</div>
                        <div className="text-[10px] md:text-xs font-semibold text-neutral-400 uppercase tracking-widest mt-1">Got It</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-neutral-800">{displayNew}</div>
                        <div className="text-[10px] md:text-xs font-semibold text-neutral-400 uppercase tracking-widest mt-1">Not Quite</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="text-2xl font-bold text-neutral-800">{displayNew}</div>
                        <div className="text-[10px] md:text-xs font-semibold text-neutral-400 uppercase tracking-widest mt-1">New Cards</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-neutral-800">{displayReview}</div>
                        <div className="text-[10px] md:text-xs font-semibold text-neutral-400 uppercase tracking-widest mt-1">Review Cards</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })()
        )}
      </div>

      {/* Action Bar */}
      <div className="flex justify-center mb-8">
        <button 
          onClick={onStudy}
          disabled={!hasDueCards}
          className="bg-black w-full md:w-auto text-white px-8 py-3.5 rounded-2xl font-medium shadow-xl shadow-black/10 hover:bg-neutral-800 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-30 disabled:grayscale text-lg"
        >
          <BookOpen size={20} />
          Study cards
        </button>
      </div>

      <div className="pb-24">
        {/* Card List */}
        <div className="space-y-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search size={18} className="text-neutral-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by card number or front text..."
              className="w-full bg-white border border-neutral-200 rounded-2xl pl-11 pr-4 py-3 outline-none focus:border-black transition-all text-sm shadow-sm"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
            <h3 className="font-medium text-neutral-400 text-sm">{filteredCards.length} Cards</h3>
            <div className="flex items-center gap-2 bg-neutral-100/50 p-1.5 rounded-xl self-start sm:self-auto overflow-x-auto w-full sm:w-auto">
              {(['all', 'new', 'due', 'next'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                    filter === f 
                      ? "bg-white shadow-sm text-black" 
                      : "text-neutral-500 hover:text-black hover:bg-white/50"
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'due' ? 'Review' : f}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin text-neutral-300" size={32} />
            </div>
          ) : filteredCards.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-neutral-200">
              <Sparkles className="w-10 h-10 text-neutral-200 mx-auto mb-4" />
              <p className="text-neutral-400 text-sm">No cards match the current filter.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
                {filteredCards.map((card) => (
                  <DeckCardItem 
                    key={card.id} 
                    card={card} 
                    onDelete={() => setDeleteCardConfirm(card)}
                    onEdit={() => {
                      setEditingCard(card);
                      setEditFront(card.front);
                      setEditBack(card.back);
                    }}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center mt-4 mb-8">
                  <button
                    onClick={() => fetchCards(false, true)}
                    disabled={loadingMore}
                    className="flex items-center gap-2 px-6 py-3 bg-white border border-neutral-200 rounded-2xl text-sm font-bold uppercase tracking-tight hover:bg-neutral-50 transition-all disabled:opacity-50 shadow-sm"
                  >
                    {loadingMore ? <Loader2 size={16} className="animate-spin" /> : <ChevronDown size={16} />}
                    Load More
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>

      {/* Floating Add Card Button */}
      {isAdmin && (
        <div className="fixed bottom-8 left-0 right-0 flex justify-center z-40 pointer-events-none">
          <button
            onClick={() => setIsAdding(true)}
            className="pointer-events-auto bg-[#1C1C1E] text-white px-7 py-4 rounded-[2rem] font-medium shadow-2xl hover:bg-black hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3 text-[15px] tracking-wide"
          >
            Add cards
          </button>
        </div>
      )}

      {/* Add Card Modal */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdding(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2rem] p-6 shadow-2xl z-10 max-h-[90vh] flex flex-col"
            >
              <div className="flex items-center justify-between mb-6 shrink-0">
                <h3 className="text-xl font-semibold text-neutral-900 px-2">Add cards</h3>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2">
                <form onSubmit={handleAddCard} className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Front (Question)</label>
                    <textarea 
                      required
                      value={newFront}
                      onChange={e => setNewFront(e.target.value)}
                      placeholder="Type the question here..."
                      rows={4}
                      className="w-full bg-neutral-50/50 border border-neutral-200 rounded-2xl px-5 py-4 outline-none focus:border-black focus:bg-white transition-all resize-none text-[15px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest pl-1">Back (Answer)</label>
                    <textarea 
                      required
                      value={newBack}
                      onChange={e => setNewBack(e.target.value)}
                      placeholder="Type the answer here..."
                      rows={4}
                      className="w-full bg-neutral-50/50 border border-neutral-200 rounded-2xl px-5 py-4 outline-none focus:border-black focus:bg-white transition-all resize-none text-[15px]"
                    />
                  </div>
                  <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-6 border-t border-neutral-100">
                    <button 
                      type="button"
                      onClick={() => setIsAdding(false)}
                      className="px-6 py-3.5 rounded-2xl font-medium text-neutral-600 hover:bg-neutral-100 transition-colors text-[15px]"
                    >
                      Cancel
                    </button>
                    <button 
                      disabled={saving}
                      type="submit"
                      className="bg-black text-white px-8 py-3.5 rounded-2xl font-medium shadow-lg shadow-black/10 hover:bg-neutral-800 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale text-[15px]"
                    >
                      {saving ? <Loader2 className="animate-spin" size={18} /> : <MessageSquarePlus size={18} />}
                      Save Card
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Card Modal */}
      <AnimatePresence>
        {editingCard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingCard(null)}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl z-10"
            >
              <h3 className="text-xl font-medium mb-6">Edit Card</h3>
              <form onSubmit={handleUpdateCard} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest pl-1">Front (Question)</label>
                  <textarea 
                    required
                    value={editFront}
                    onChange={e => setEditFront(e.target.value)}
                    rows={4}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-4 py-3 outline-none focus:border-black transition-all resize-none text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest pl-1">Back (Answer)</label>
                  <textarea 
                    required
                    value={editBack}
                    onChange={e => setEditBack(e.target.value)}
                    rows={4}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-4 py-3 outline-none focus:border-black transition-all resize-none text-sm"
                  />
                </div>
                <div className="flex items-center justify-end gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setEditingCard(null)}
                    className="px-5 py-2.5 rounded-xl font-medium text-neutral-600 hover:bg-neutral-100 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={saving}
                    className="bg-black text-white px-6 py-2.5 rounded-xl font-medium shadow-xl hover:bg-neutral-800 transition-all active:scale-[0.98] flex items-center gap-2 disabled:opacity-50 text-sm"
                  >
                    {saving && <Loader2 className="animate-spin" size={16} />}
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Delete Card Confirm */}
      <AnimatePresence>
        {deleteCardConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeleteCardConfirm(null)} className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl z-10 border border-neutral-200 text-center">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-600 mx-auto mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-xl font-medium mb-2">Delete Card?</h3>
              <p className="text-neutral-500 text-sm mb-6">Are you sure you want to delete this card? This action cannot be undone.</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setDeleteCardConfirm(null)} className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 font-medium hover:bg-neutral-50 transition-all text-neutral-600">Cancel</button>
                <button disabled={loading} onClick={() => handleDeleteCard(deleteCardConfirm.id)} className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition-all flex justify-center">{loading ? <Loader2 className="animate-spin" size={18} /> : 'Delete'}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reset Progress Confirm */}
      <AnimatePresence>
        {resetConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setResetConfirm(false)} className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl z-10 border border-neutral-200 text-center">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-600 mx-auto mb-4">
                <RotateCcw size={24} />
              </div>
              <h3 className="text-xl font-medium mb-2">Reset Progress?</h3>
              <p className="text-neutral-500 text-sm mb-6">Are you sure you want to reset all progress for this deck? All cards will become NEW cards.</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setResetConfirm(false)} className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 font-medium hover:bg-neutral-50 transition-all text-neutral-600">Cancel</button>
                <button disabled={loading} onClick={() => {
                  handleResetProgress().then(() => setResetConfirm(false));
                }} className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition-all flex justify-center">{loading ? <Loader2 className="animate-spin" size={18} /> : 'Reset'}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
