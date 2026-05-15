import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, doc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, getCountFromServer } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Plus, Trash2, Edit2, Send, Save, AlertTriangle, Users, BookCopy, Zap, X } from 'lucide-react';
import { SRSMode } from '../types';

// Double protection — Firestore rules are the real security layer
// Set this to your actual admin UID from the Firebase Console Authentication tab
const ADMIN_UID = "YOUR_ADMIN_UID_HERE";

interface AdminCardDraft {
  id: string; // just a local id for the form
  front: string;
  back: string;
}

interface AdminDeck {
  id: string;
  title: string;
  description: string;
  srsMode: SRSMode;
  tags: string[];
  cards: Omit<AdminCardDraft, 'id'>[];
  isPublished: boolean;
  publishedAt?: any;
  pushedToUsersCount?: number;
}

export function AdminPanel() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ users: 0, drafted: 0, pushes: 0 });
  const [adminDecks, setAdminDecks] = useState<AdminDeck[]>([]);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [srsMode, setSrsMode] = useState<SRSMode>("general");
  const [tags, setTags] = useState("");
  const [cards, setCards] = useState<AdminCardDraft[]>([{ id: '1', front: '', back: '' }]);
  
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [dryRun, setDryRun] = useState(false);

  useEffect(() => {
    if (auth.currentUser?.uid === ADMIN_UID) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, []);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fetch stats
      const usersSnap = await getCountFromServer(collection(db, "users"));
      const usersCount = usersSnap.data().count;

      const adminDecksSnap = await getDocs(collection(db, "admin_decks"));
      const fetchedDecks = adminDecksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AdminDeck));
      
      const draftedCount = fetchedDecks.filter(d => !d.isPublished).length;
      const pushesCount = fetchedDecks.filter(d => d.isPublished).length; // or reduce pushedToUsersCount

      setStats({ users: usersCount, drafted: draftedCount, pushes: pushesCount });
      setAdminDecks(fetchedDecks);
    } catch (err) {
      console.error(err);
      showToast("Failed to fetch admin data", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!auth.currentUser || auth.currentUser.uid !== ADMIN_UID) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center h-[70vh]">
        <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-neutral-900 mb-2">Access Denied</h2>
        <p className="text-neutral-500 max-w-md">
          You do not have permission to view this page. Frontend isAdmin check is for UX only. Real security is enforced by Firestore rules.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  const openNewForm = () => {
    setEditingDeckId(null);
    setTitle("");
    setDescription("");
    setSrsMode("general");
    setTags("");
    setCards([{ id: Date.now().toString(), front: '', back: '' }]);
    setIsFormOpen(true);
  };

  const openEditForm = (deck: AdminDeck) => {
    setEditingDeckId(deck.id);
    setTitle(deck.title);
    setDescription(deck.description || "");
    setSrsMode(deck.srsMode || "general");
    setTags((deck.tags || []).join(", "));
    setCards(deck.cards?.length ? deck.cards.map((c, i) => ({ id: i.toString(), front: c.front, back: c.back })) : [{ id: Date.now().toString(), front: '', back: '' }]);
    setIsFormOpen(true);
  };

  const handleAddCard = () => {
    setCards([...cards, { id: Date.now().toString(), front: '', back: '' }]);
  };

  const handleRemoveCard = (id: string) => {
    if (cards.length > 1) {
      setCards(cards.filter(c => c.id !== id));
    }
  };

  const updateCard = (id: string, field: 'front' | 'back', value: string) => {
    setCards(cards.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleSaveDeck = async () => {
    const validCards = cards.filter(c => c.front.trim() && c.back.trim());
    
    if (!title.trim()) {
      showToast("Title is required", "error");
      return;
    }
    if (validCards.length === 0) {
      showToast("At least 1 complete card is required", "error");
      return;
    }

    setSaving(true);
    try {
      const tagArray = tags.split(',').map(t => t.trim()).filter(t => t);
      
      const deckData = {
        title: title.trim(),
        description: description.trim(),
        srsMode,
        tags: tagArray,
        cards: validCards.map(c => ({ front: c.front, back: c.back })),
        isPublished: false,
        updatedAt: serverTimestamp(),
      };

      if (editingDeckId) {
        await updateDoc(doc(db, "admin_decks", editingDeckId), deckData);
        showToast("Draft updated", "success");
      } else {
        const newDocRef = doc(collection(db, "admin_decks"));
        await setDoc(newDocRef, { ...deckData, isPublished: false, createdAt: serverTimestamp() });
        showToast("Draft saved", "success");
      }
      setIsFormOpen(false);
      fetchData();
    } catch (err) {
      console.error(err);
      showToast("Failed to save draft", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDeck = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this admin deck? This won't affect user decks.")) return;
    try {
      await deleteDoc(doc(db, "admin_decks", id));
      setAdminDecks(adminDecks.filter(d => d.id !== id));
      showToast("Deck deleted", "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to delete", "error");
    }
  };

  const handlePushDeck = async (deck: AdminDeck) => {
    if (!window.confirm(`Push to ${stats.users} users?`)) return;
    setPushing(deck.id);
    
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const userIds = usersSnap.docs.map(d => d.id);
      
      if (dryRun) {
        console.log(`[DRY RUN] Would push "${deck.title}" with ${deck.cards.length} cards to ${userIds.length} users.`);
        showToast(`[DRY RUN] Would push to ${userIds.length} users`, "success");
        setPushing(null);
        return;
      }

      const deckCards = deck.cards;
      let opsCount = 0;
      let batch = writeBatch(db);
      
      const commitBatchAndReset = async () => {
        await batch.commit();
        batch = writeBatch(db);
        opsCount = 0;
      };

      for (const uid of userIds) {
        const newDeckRef = doc(collection(db, "decks"));
        batch.set(newDeckRef, {
          userId: uid,
          title: deck.title,
          description: deck.description || "",
          cardCount: deckCards.length,
          srsMode: deck.srsMode || "general",
          lastCardNumber: 0,
          tags: deck.tags || [],
          createdAt: serverTimestamp()
        });
        opsCount++;

        if (opsCount >= 400) await commitBatchAndReset();

        for (const card of deckCards) {
          const cardRef = doc(collection(db, `decks/${newDeckRef.id}/cards`));
          batch.set(cardRef, {
            deckId: newDeckRef.id,
            front: card.front,
            back: card.back,
            progress: {},
            nextReview: serverTimestamp(),
            interval: 0,
            easeFactor: 2.5,
            repetitionCount: 0,
            lastRating: 0,
            createdAt: serverTimestamp()
          });
          opsCount++;
          
          if (opsCount >= 400) await commitBatchAndReset();
        }
      }
      
      if (opsCount > 0) {
        await commitBatchAndReset();
      }

      await updateDoc(doc(db, "admin_decks", deck.id), {
        isPublished: true,
        publishedAt: serverTimestamp(),
        pushedToUsersCount: userIds.length
      });

      showToast(`Successfully pushed to ${userIds.length} users!`, "success");
      fetchData();
    } catch (err) {
      console.error(err);
      showToast("Failed to push deck. Check console.", "error");
    } finally {
      setPushing(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-6 right-6 z-[100] px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 text-white font-medium ${toast.type === "error" ? "bg-red-500" : "bg-black"}`}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-sans font-medium tracking-tight text-neutral-900">Admin Dashboard</h1>
          <p className="text-neutral-500 mt-1">Manage global decks and broadcast to all users.</p>
        </div>
        <button 
          onClick={openNewForm}
          className="bg-black text-white rounded-xl px-5 py-2.5 text-sm font-medium flex items-center gap-2 hover:bg-neutral-800 transition-all shadow-sm"
        >
          <Plus size={18} />
          Create Deck
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 flex flex-col gap-2">
          <div className="flex items-center gap-3 text-neutral-500 mb-2">
            <Users size={20} className="text-blue-500" />
            <span className="font-medium">Total Users</span>
          </div>
          <span className="text-4xl font-semibold tracking-tight">{stats.users}</span>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 flex flex-col gap-2">
          <div className="flex items-center gap-3 text-neutral-500 mb-2">
            <BookCopy size={20} className="text-amber-500" />
            <span className="font-medium">Drafts</span>
          </div>
          <span className="text-4xl font-semibold tracking-tight">{stats.drafted}</span>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 flex flex-col gap-2">
          <div className="flex items-center gap-3 text-neutral-500 mb-2">
            <Zap size={20} className="text-green-500" />
            <span className="font-medium">Pushes Done</span>
          </div>
          <span className="text-4xl font-semibold tracking-tight">{stats.pushes}</span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-8 mb-4">
        <h2 className="text-xl font-semibold tracking-tight">Admin Decks</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-neutral-600 font-medium bg-white px-4 py-2 rounded-xl border border-neutral-200 shadow-sm cursor-pointer hover:bg-neutral-50 transition-colors">
            <input 
              type="checkbox" 
              checked={dryRun} 
              onChange={e => setDryRun(e.target.checked)}
              className="rounded text-black focus:ring-black"
            />
            Dry Run Mode
          </label>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {adminDecks.length === 0 ? (
          <div className="col-span-1 md:col-span-2 text-center p-12 bg-white rounded-2xl border border-neutral-200 shadow-sm">
            <p className="text-neutral-500">No admin decks found.</p>
          </div>
        ) : adminDecks.map(deck => (
          <div key={deck.id} className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-6 flex-1">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md ${deck.isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {deck.isPublished ? 'Published' : 'Draft'}
                </span>
                <span className="text-xs bg-neutral-100 text-neutral-600 px-2 py-1 rounded-md font-medium capitalize">
                  {deck.srsMode}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-neutral-900 leading-tight mb-1">{deck.title}</h3>
              <p className="text-sm text-neutral-500 line-clamp-2 mb-4">{deck.description}</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {deck.tags?.map(t => (
                  <span key={t} className="text-xs bg-neutral-50 border border-neutral-200 text-neutral-600 px-2 py-1 rounded-lg">#{t}</span>
                ))}
              </div>
              <p className="text-sm font-medium text-neutral-600">
                {deck.cards?.length || 0} cards
              </p>
            </div>
            <div className="border-t border-neutral-100 bg-neutral-50 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => openEditForm(deck)}
                  className="p-2 border border-neutral-200 bg-white rounded-lg hover:bg-neutral-50 text-neutral-600 transition-colors"
                  title="Edit Deck"
                >
                  <Edit2 size={16} />
                </button>
                <button 
                  onClick={() => handleDeleteDeck(deck.id)}
                  className="p-2 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100 text-red-500 transition-colors"
                  title="Delete Deck"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              
              <button 
                onClick={() => handlePushDeck(deck)}
                disabled={pushing === deck.id}
                className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all ${pushing === deck.id ? "bg-neutral-200 text-neutral-500 cursor-not-allowed" : "bg-black text-white hover:bg-neutral-800"}`}
              >
                {pushing === deck.id ? (
                  <><Loader2 size={16} className="animate-spin" /> Pushing...</>
                ) : (
                  <><Send size={16} /> Push to All</>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {isFormOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
              onClick={() => setIsFormOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.95 }} 
              animate={{ opacity: 1, y: 0, scale: 1 }} 
              exit={{ opacity: 0, y: 50, scale: 0.95 }}
              className="fixed inset-0 m-auto w-full max-w-4xl h-[90vh] bg-white rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col"
            >
              <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between shrink-0 bg-white">
                <h2 className="text-xl font-semibold tracking-tight">{editingDeckId ? 'Edit Draft' : 'Create Admin Deck'}</h2>
                <button onClick={() => setIsFormOpen(false)} className="text-neutral-400 hover:text-black transition-colors">
                  <X size={24} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 bg-[#F5F5F5]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Left Column: Details */}
                  <div className="space-y-6">
                    <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-sm space-y-4">
                      <h3 className="font-semibold border-b border-neutral-100 pb-2">Deck Details</h3>
                      
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Title *</label>
                        <input 
                          type="text" 
                          value={title} 
                          onChange={e => setTitle(e.target.value)}
                          placeholder="Deck title..."
                          className="w-full border-neutral-200 rounded-xl px-4 py-2 border outline-none focus:border-black transition-all"
                        />
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Description</label>
                        <textarea 
                          value={description} 
                          onChange={e => setDescription(e.target.value)}
                          placeholder="Optional description"
                          rows={3}
                          className="w-full border-neutral-200 rounded-xl px-4 py-2 border outline-none focus:border-black transition-all resize-none"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">SRS Mode</label>
                        <select 
                          value={srsMode} 
                          onChange={e => setSrsMode(e.target.value as SRSMode)}
                          className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-2 outline-none"
                        >
                          <option value="general">General (Standard Intervals)</option>
                          <option value="fast">Fast (Quick Reviews)</option>
                          <option value="medical">Medical (Deep Retention)</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Tags</label>
                        <input 
                          type="text" 
                          value={tags} 
                          onChange={e => setTags(e.target.value)}
                          placeholder="e.g. math, basics"
                          className="w-full border-neutral-200 rounded-xl px-4 py-2 border outline-none focus:border-black transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Cards */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">Cards ({cards.length})</h3>
                      <button 
                        onClick={handleAddCard}
                        className="text-sm font-medium text-black bg-white border border-neutral-200 px-3 py-1.5 rounded-lg hover:bg-neutral-50 transition-colors flex items-center gap-1.5"
                      >
                        <Plus size={16} /> Add Card
                      </button>
                    </div>

                    <div className="space-y-4 pr-1">
                      {cards.map((card, index) => (
                        <div key={card.id} className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm relative group">
                          <button 
                            onClick={() => handleRemoveCard(card.id)}
                            className={`absolute -top-3 -right-3 bg-white border border-neutral-200 text-neutral-400 hover:text-red-500 hover:border-red-200 rounded-full p-1.5 shadow-sm transition-all ${cards.length <= 1 ? 'hidden' : 'opacity-0 group-hover:opacity-100'}`}
                          >
                            <Trash2 size={14} />
                          </button>
                          <div className="mb-2 text-xs font-bold text-neutral-400">Card {index + 1}</div>
                          <div className="space-y-3">
                            <textarea
                              placeholder="Front (Question)"
                              value={card.front}
                              onChange={e => updateCard(card.id, 'front', e.target.value)}
                              rows={2}
                              className="w-full border-neutral-200 bg-neutral-50 rounded-lg px-3 py-2 border outline-none focus:border-black focus:bg-white transition-all text-sm resize-none"
                            />
                            <textarea
                              placeholder="Back (Answer)"
                              value={card.back}
                              onChange={e => updateCard(card.id, 'back', e.target.value)}
                              rows={2}
                              className="w-full border-neutral-200 bg-neutral-50 rounded-lg px-3 py-2 border outline-none focus:border-black focus:bg-white transition-all text-sm resize-none"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-neutral-100 shrink-0 bg-white flex justify-end gap-3">
                <button 
                  onClick={() => setIsFormOpen(false)}
                  className="px-5 py-2.5 rounded-xl font-medium text-neutral-600 hover:bg-neutral-100 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveDeck}
                  disabled={saving}
                  className="bg-black text-white px-6 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-neutral-800 transition-colors shadow-sm disabled:opacity-50"
                >
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  Save Draft
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
