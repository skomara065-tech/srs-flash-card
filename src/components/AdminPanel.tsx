import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, doc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, getCountFromServer, where } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Plus, Trash2, Edit2, Send, Save, AlertTriangle, Users, BookCopy, Zap, X, ChevronLeft, ChevronRight, BookOpen, MoreVertical, Sparkles, MessageSquarePlus, Settings2, Stethoscope, Search, Layers, Clock, ArrowLeft, FolderPlus, Folder as FolderIcon, Move } from 'lucide-react';
import { SRSMode } from '../types';

interface AdminFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt?: any;
  updatedAt?: any;
}

interface AdminCardDraft {
  id: string;
  front: string;
  back: string;
}

interface AdminDeck {
  id: string;
  title: string;
  description: string;
  srsMode: SRSMode;
  tags: string[];
  cards: AdminCardDraft[];
  isPublished: boolean;
  publishedAt?: any;
  pushedToUsersCount?: number;
  parentId?: string | null;
  folderId?: string | null;
}

export function AdminPanel({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ users: 0, drafted: 0, pushes: 0 });
  const [adminDecks, setAdminDecks] = useState<AdminDeck[]>([]);
  const [adminFolders, setAdminFolders] = useState<AdminFolder[]>([]);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [parentFolderIdForNew, setParentFolderIdForNew] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{type: 'folder' | 'deck', id: string, name: string} | null>(null);
  const [isMovingDeck, setIsMovingDeck] = useState<AdminDeck | null>(null);
  const [isMovingFolder, setIsMovingFolder] = useState<AdminFolder | null>(null);
  const [editingFolder, setEditingFolder] = useState<AdminFolder | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  
  const [selectedDeck, setSelectedDeck] = useState<AdminDeck | null>(null);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [srsMode, setSrsMode] = useState<SRSMode>("general");
  const [tags, setTags] = useState("");
  
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const usersSnap = await getCountFromServer(collection(db, "users"));
      const usersCount = usersSnap.data().count;

      const adminDecksSnap = await getDocs(collection(db, "admin_decks"));
      const fetchedDecks = adminDecksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AdminDeck));
      
      const adminFoldersSnap = await getDocs(collection(db, "admin_folders"));
      const fetchedFolders = adminFoldersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AdminFolder));

      const draftedCount = fetchedDecks.filter(d => !d.isPublished).length;
      const pushesCount = fetchedDecks.filter(d => d.isPublished).length;

      setStats({ users: usersCount, drafted: draftedCount, pushes: pushesCount });
      setAdminDecks(fetchedDecks);
      setAdminFolders(fetchedFolders);
    } catch (err) {
      console.error(err);
      showToast("Failed to fetch admin data", "error");
    } finally {
      setLoading(false);
    }
  };

  const toggleFolder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      setSaving(true);
      const folderData = {
        name: newFolderName,
        parentId: parentFolderIdForNew || null,
        createdAt: serverTimestamp(),
      };
      const newDocRef = doc(collection(db, "admin_folders"));
      await setDoc(newDocRef, folderData);
      
      const createdFolder: AdminFolder = {
        id: newDocRef.id,
        ...folderData,
      } as AdminFolder;

      setAdminFolders(prev => [createdFolder, ...prev]);
      setNewFolderName("");
      setIsFolderModalOpen(false);
      setParentFolderIdForNew(null);
      showToast("Folder created", "success");
    } catch (err) {
      showToast("Failed to create folder", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFolder || !newFolderName.trim()) return;

    try {
      setSaving(true);
      await updateDoc(doc(db, "admin_folders", editingFolder.id), {
        name: newFolderName,
        updatedAt: serverTimestamp()
      });
      setAdminFolders(prev => prev.map(f => f.id === editingFolder.id ? { ...f, name: newFolderName } : f));
      setEditingFolder(null);
      setNewFolderName("");
      showToast("Folder renamed", "success");
    } catch (err) {
      showToast("Failed to rename folder", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      setSaving(true);
      const batch = writeBatch(db);
      batch.delete(doc(db, "admin_folders", folderId));

      const decksInFolder = adminDecks.filter(d => d.folderId === folderId || d.parentId === folderId);
      decksInFolder.forEach(d => {
        batch.update(doc(db, "admin_decks", d.id), {
          folderId: null,
          parentId: null,
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();

      setAdminFolders(prev => prev.filter(f => f.id !== folderId));
      setAdminDecks(prev => prev.map(d => (d.folderId === folderId || d.parentId === folderId) ? { ...d, folderId: null, parentId: null } : d));
      showToast("Folder deleted", "success");
    } catch (err) {
      showToast("Failed to delete folder", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleMoveDeck = async (deck: AdminDeck, parentId: string | null) => {
    try {
      await updateDoc(doc(db, "admin_decks", deck.id), {
        parentId: parentId || null,
        folderId: parentId || null, // keeping both aligned for simplicity
        updatedAt: serverTimestamp()
      });
      setAdminDecks(prev => prev.map(d => d.id === deck.id ? { ...d, parentId: parentId || null, folderId: parentId || null } : d));
      setIsMovingDeck(null);
      showToast("Deck moved", "success");
    } catch (err) {
      showToast("Failed to move deck", "error");
    }
  };

  const handleMoveFolder = async (folder: AdminFolder, parentId: string | null) => {
    try {
      await updateDoc(doc(db, "admin_folders", folder.id), {
        parentId: parentId || null,
        updatedAt: serverTimestamp()
      });
      setAdminFolders(prev => prev.map(f => f.id === folder.id ? { ...f, parentId: parentId || null } : f));
      setIsMovingFolder(null);
      showToast("Folder moved", "success");
    } catch (err) {
      showToast("Failed to move folder", "error");
    }
  };

  const openNewForm = () => {
    setTitle("");
    setDescription("");
    setSrsMode("general");
    setTags("");
    setIsFormOpen(true);
  };

  const handleSaveNewDeck = async () => {
    if (!title.trim()) {
      showToast("Title is required", "error");
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
        cards: [],
        isPublished: false,
        createdAt: serverTimestamp(),
        parentId: selectedFolderId || parentFolderIdForNew || null,
        folderId: selectedFolderId || parentFolderIdForNew || null,
      };

      const newDocRef = doc(collection(db, "admin_decks"));
      await setDoc(newDocRef, deckData);
      
      const newDeck: AdminDeck = { id: newDocRef.id, ...deckData } as AdminDeck;
      setAdminDecks(prev => [newDeck, ...prev]);
      
      showToast("Draft deck created", "success");
      setIsFormOpen(false);
      setSelectedDeck(newDeck);
      setParentFolderIdForNew(null);
      setSelectedFolderId(null);
    } catch (err) {
      console.error(err);
      showToast("Failed to create deck", "error");
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
      if (selectedDeck?.id === id) {
        setSelectedDeck(null);
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to delete", "error");
    }
  };

  const handlePushDeck = async (deck: AdminDeck) => {
    if (!window.confirm(`Publish/Update to all users?`)) return;
    setPushing(deck.id);
    
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const userIds = usersSnap.docs.map(d => d.id);
      
      if (dryRun) {
        console.log(`[DRY RUN] Would publish/update "${deck.title}" with ${deck.cards.length} cards to ${userIds.length} users.`);
        showToast(`[DRY RUN] Would push to ${userIds.length} users`, "success");
        setPushing(null);
        return;
      }

      const deckCards = deck.cards || [];
      let opsCount = 0;
      let batch = writeBatch(db);
      
      const commitBatchAndReset = async () => {
        await batch.commit();
        batch = writeBatch(db);
        opsCount = 0;
      };

      for (const uid of userIds) {
        const userDeckId = `admin_${deck.id}_${uid}`;
        const parentId = deck.parentId ? `admin_${deck.parentId}_${uid}` : null;
        const folderId = deck.folderId ? `admin_${deck.folderId}_${uid}` : null;
        
        batch.set(doc(db, "decks", userDeckId), {
          userId: uid,
          adminDeckId: deck.id,
          title: deck.title,
          description: deck.description || "",
          cardCount: deckCards.length,
          srsMode: deck.srsMode || "general",
          tags: deck.tags || [],
          parentId: parentId,
          folderId: folderId,
          dueCounts: {
            general: deckCards.length,
            fast: deckCards.length,
            medical: deckCards.length,
          },
          updatedAt: serverTimestamp()
        }, { merge: true });
        
        opsCount++;
        if (opsCount >= 400) await commitBatchAndReset();

        for (const card of deckCards) {
          const cardId = `admin_${deck.id}_${card.id}`;
          const newCardProgress = {
            nextReview: new Date(1000),
            interval: 0,
            easeFactor: 2.5,
            repetitionCount: 0,
            lastRating: 0,
            status: 'learning',
            learningStep: 0,
            passCount: 0,
            failCount: 0,
          };
          batch.set(doc(db, `decks/${userDeckId}/cards`, cardId), {
            deckId: userDeckId,
            front: card.front,
            back: card.back,
            ...newCardProgress,
            progress: {
              general: newCardProgress,
              fast: newCardProgress,
              medical: newCardProgress,
            },
            updatedAt: serverTimestamp()
          }, { merge: true });
          
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

      showToast(`Successfully published for ${userIds.length} users!`, "success");
      setShowSuccessAnim(true);
      setTimeout(() => setShowSuccessAnim(false), 2500);
      
      const updatedDeck = { ...deck, isPublished: true, pushedToUsersCount: userIds.length };
      setAdminDecks(prev => prev.map(d => d.id === deck.id ? updatedDeck : d));
      if (selectedDeck?.id === deck.id) setSelectedDeck(updatedDeck);
      
    } catch (err) {
      console.error(err);
      showToast("Failed to push deck. Check console.", "error");
    } finally {
      setPushing(null);
    }
  };

  const handlePushAll = async () => {
    if (!window.confirm("Publish/Update ALL folders and decks to ALL users? This will replicate the exact admin structure to every user.")) return;
    try {
      setLoading(true);
      const usersSnap = await getDocs(collection(db, "users"));
      const userIds = usersSnap.docs.map(d => d.id);

      if (dryRun) {
        showToast(`[DRY RUN] Would push ${adminFolders.length} folders and ${adminDecks.length} decks to ${userIds.length} users.`, "success");
        return;
      }

      let batch = writeBatch(db);
      let opsCount = 0;

      const commitBatchAndReset = async () => {
        await batch.commit();
        batch = writeBatch(db);
        opsCount = 0;
      };

      for (const uid of userIds) {
        // Sync Folders
        for (const folder of adminFolders) {
          const userFolderId = `admin_${folder.id}_${uid}`;
          const parentId = folder.parentId ? `admin_${folder.parentId}_${uid}` : null;
          
          batch.set(doc(db, "folders", userFolderId), {
            userId: uid,
            adminFolderId: folder.id,
            name: folder.name,
            parentId: parentId,
            updatedAt: serverTimestamp()
          }, { merge: true });
          
          opsCount++;
          if (opsCount >= 400) await commitBatchAndReset();
        }

        // Sync Decks
        for (const deck of adminDecks) {
          const userDeckId = `admin_${deck.id}_${uid}`;
          const parentId = deck.parentId ? `admin_${deck.parentId}_${uid}` : null;
          const folderId = deck.folderId ? `admin_${deck.folderId}_${uid}` : null;
          const deckCards = deck.cards || [];
          
          batch.set(doc(db, "decks", userDeckId), {
            userId: uid,
            adminDeckId: deck.id,
            title: deck.title,
            description: deck.description || "",
            cardCount: deckCards.length,
            srsMode: deck.srsMode || "general",
            tags: deck.tags || [],
            parentId: parentId,
            folderId: folderId,
            dueCounts: {
              general: deckCards.length,
              fast: deckCards.length,
              medical: deckCards.length,
            },
            updatedAt: serverTimestamp()
          }, { merge: true });
          
          opsCount++;
          if (opsCount >= 400) await commitBatchAndReset();

          // Instead of syncing cards incrementally, we just set them. (Assuming cards aren't massively updated).
          for (const card of deckCards) {
             const cardId = `admin_${deck.id}_${card.id}`;
             // Since we use merge: true, we won't overwrite progress if the card already exists.
             // We only update the front and back. But if it's new, it creates it without progress.
             // We cannot easily do a conditional set without a read.
             // Given the Firestore batch limit and reads limit, we'll just update front and back.
             const newCardProgress = {
               nextReview: new Date(1000),
               interval: 0,
               easeFactor: 2.5,
               repetitionCount: 0,
               lastRating: 0,
               status: 'learning',
               learningStep: 0,
               passCount: 0,
               failCount: 0,
             };
             batch.set(doc(db, `decks/${userDeckId}/cards`, cardId), {
                deckId: userDeckId,
                front: card.front,
                back: card.back,
                ...newCardProgress,
                progress: {
                  general: newCardProgress,
                  fast: newCardProgress,
                  medical: newCardProgress,
                },
                updatedAt: serverTimestamp()
             }, { merge: true });
             
             opsCount++;
             if (opsCount >= 400) await commitBatchAndReset();
          }
        }
      }

      if (opsCount > 0) {
        await commitBatchAndReset();
      }

      showToast(`Successfully published all decks & folders to ${userIds.length} users!`, "success");
      setShowSuccessAnim(true);
      setTimeout(() => setShowSuccessAnim(false), 2500);
    } catch (err) {
      console.error("Push all failed", err);
      showToast("Failed: " + String(err.message || err), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateDeck = (deckId: string, updates: Partial<AdminDeck>) => {
    setAdminDecks(prev => prev.map(d => d.id === deckId ? { ...d, ...updates } : d));
    if (selectedDeck?.id === deckId) {
      setSelectedDeck(prev => prev ? { ...prev, ...updates } : prev);
    }
  };

  return (
    <div className="space-y-8">
      <AnimatePresence>
        {showSuccessAnim && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: -20 }}
              transition={{ type: "spring", bounce: 0.5 }}
              className="bg-white rounded-3xl p-8 sm:p-12 flex flex-col items-center justify-center shadow-2xl max-w-sm w-full text-center"
            >
              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", bounce: 0.5, delay: 0.1 }}
                className="w-24 h-24 bg-green-100 text-green-500 rounded-full flex items-center justify-center mb-6"
              >
                <Zap size={48} className="fill-current" />
              </motion.div>
              <h2 className="text-2xl sm:text-3xl font-bold text-neutral-900 mb-2">Push Successful!</h2>
              <p className="text-neutral-500 font-medium">All users have received the latest updates.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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

      {selectedDeck ? (
        <AdminDeckDetail 
          deck={selectedDeck}
          onBack={() => setSelectedDeck(null)}
          onUpdateDeck={(updates) => handleUpdateDeck(selectedDeck.id, updates)}
          onDeleteDeck={() => handleDeleteDeck(selectedDeck.id)}
          onPushDeck={() => handlePushDeck(selectedDeck)}
          pushing={pushing === selectedDeck.id}
          showToast={showToast}
        />
      ) : (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-2 border-b border-neutral-100">
            <div>
              <button
                onClick={onBack}
                className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-2"
              >
                <ChevronLeft size={16} />
                Back to User View
              </button>
              <h2 className="text-3xl font-medium tracking-tight text-neutral-900 leading-none">
                Admin Dashboard
              </h2>
              <p className="text-neutral-500 mt-2 text-sm">
                Manage global decks and broadcast to all users.
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-colors cursor-pointer border ${dryRun ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-neutral-50 border-neutral-200 text-neutral-500'}`}
                onClick={() => setDryRun(!dryRun)}
                title="When ON, pushing decks only logs to console — no data is written"
              >
                <div className={`w-8 h-4 rounded-full transition-colors flex items-center px-0.5 ${dryRun ? 'bg-amber-400' : 'bg-neutral-300'}`}>
                  <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${dryRun ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
                <span className="text-xs font-bold uppercase tracking-widest leading-none">Dry Run</span>
              </div>

              <button 
                onClick={handlePushAll}
                className="bg-blue-600 text-white rounded-xl px-5 py-2 text-sm font-medium flex items-center gap-2 hover:bg-blue-700 transition-all active:scale-[0.98] shadow-sm tracking-wide"
              >
                <Zap size={18} />
                Publish All Decks & Folders
              </button>

              <button 
                onClick={() => { setParentFolderIdForNew(null); setNewFolderName(""); setIsFolderModalOpen(true); }}
                className="bg-white border border-neutral-200 text-neutral-600 rounded-xl px-5 py-2 text-sm font-medium flex items-center gap-2 hover:bg-neutral-50 transition-all active:scale-[0.98] shadow-sm tracking-wide"
              >
                <FolderPlus size={18} />
                New Folder
              </button>

              <button 
                onClick={openNewForm}
                className="bg-black text-white rounded-xl px-5 py-2 text-sm font-medium flex items-center gap-2 hover:bg-neutral-800 transition-all active:scale-[0.98] shadow-sm tracking-wide"
              >
                <Plus size={18} />
                Create Deck
              </button>
            </div>
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

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-neutral-300" size={32} />
            </div>
          ) : adminDecks.length === 0 ? (
            <div className="text-center py-24 bg-white rounded-3xl border border-dashed border-neutral-200">
              <Layers className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium">No admin decks</h3>
              <p className="text-neutral-500 max-w-xs mx-auto">Create your first global deck to get started.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col border-t border-b border-neutral-100 divide-y divide-neutral-100">
                {(() => {
                  const renderTree = (parentId: string | null = null, depth = 0): React.ReactNode => {
                    const treeFolders = adminFolders.filter(f => f.parentId === parentId || (parentId === null && !f.parentId));
                    const treeDecks = adminDecks.filter(d => (d.parentId || d.folderId || null) === parentId);

                    return (
                      <div className={`flex flex-col divide-y divide-neutral-100 w-full ${depth > 0 ? "ml-4 border-l border-neutral-100 pl-4 py-1" : ""}`}>
                        {treeFolders.map(folder => {
                          const isExpanded = expandedFolders.has(folder.id);
                          const hasChildren = adminFolders.some(f => f.parentId === folder.id) || adminDecks.some(d => (d.parentId || d.folderId) === folder.id);
                          const deckCount = adminDecks.filter(d => (d.parentId || d.folderId) === folder.id).length;

                          return (
                            <div key={`folder-${folder.id}`} className="flex flex-col">
                              <div className="flex items-center group relative px-2 hover:bg-neutral-50 transition-colors cursor-pointer">
                                {hasChildren ? (
                                  <button onClick={(e) => toggleFolder(folder.id, e)} className="mr-3 w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-500 hover:bg-neutral-200 flex-shrink-0">
                                    {isExpanded ? <span className="text-lg leading-none mb-0.5">-</span> : <span className="text-lg leading-none mb-0.5">+</span>}
                                  </button>
                                ) : (
                                  <div className="mr-3 w-6 h-6 flex-shrink-0" />
                                )}
                                <div 
                                  onClick={(e) => hasChildren ? toggleFolder(folder.id, e) : undefined}
                                  className="flex-1 py-4 flex flex-row items-center justify-between"
                                >
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-semibold text-neutral-900 truncate text-base">{folder.name} <span className="text-xs bg-neutral-200 px-1 py-0.5 rounded text-neutral-600">Folder</span></h4>
                                    <p className="text-sm text-neutral-500">{deckCount} {deckCount === 1 ? 'item' : 'items'}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setParentFolderIdForNew(folder.id); openNewForm(); }}
                                    className="p-2 hover:bg-neutral-200 rounded-lg text-neutral-400 hover:text-black transition-colors" title="New Subdeck"
                                  >
                                    <FolderPlus size={16} />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setEditingFolder(folder); setNewFolderName(folder.name); setIsFolderModalOpen(true); }}
                                    className="p-2 hover:bg-neutral-200 rounded-lg text-neutral-400 hover:text-black transition-colors" title="Rename folder"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setIsMovingFolder(folder); }}
                                    className="p-2 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-200 transition-all" title="Move folder"
                                  >
                                    <Move size={16} />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                                    className="p-2 hover:bg-red-50 rounded-lg text-neutral-400 hover:text-red-500 transition-colors" title="Delete folder"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                              {isExpanded && hasChildren && renderTree(folder.id, depth + 1)}
                            </div>
                          );
                        })}

                        {treeDecks.map(deck => {
                          const isExpanded = expandedFolders.has(deck.id);
                          const hasChildren = adminDecks.some(d => d.parentId === deck.id);

                          return (
                            <div key={`deck-${deck.id}`} className="flex flex-col">
                              <div className="flex items-center group relative px-2 hover:bg-neutral-50 transition-colors cursor-pointer">
                                {hasChildren ? (
                                  <button onClick={(e) => toggleFolder(deck.id, e)} className="mr-3 w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-500 hover:bg-neutral-200 flex-shrink-0">
                                    {isExpanded ? <span className="text-lg leading-none mb-0.5">-</span> : <span className="text-lg leading-none mb-0.5">+</span>}
                                  </button>
                                ) : (
                                  <div className="mr-3 w-6 h-6 flex-shrink-0" />
                                )}
                                <div 
                                  onClick={() => setSelectedDeck(deck)}
                                  className="flex-1 py-4 flex flex-row items-center justify-between"
                                >
                                  <div className="flex-1 min-w-0 flex items-center gap-2">
                                    <h4 className="font-semibold text-neutral-900 truncate text-base">{deck.title}</h4>
                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${deck.isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                      {deck.isPublished ? 'Published' : 'Draft'}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setParentFolderIdForNew(deck.id); openNewForm(); }}
                                    className="p-2 hover:bg-neutral-200 rounded-lg text-neutral-400 hover:text-black transition-colors" title="New Subdeck"
                                  >
                                    <FolderPlus size={16} />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setIsMovingDeck(deck); }}
                                    className="p-2 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-200 transition-all" title="Move deck"
                                  >
                                    <Move size={16} />
                                  </button>
                                </div>
                              </div>
                              {isExpanded && hasChildren && renderTree(deck.id, depth + 1)}
                            </div>
                          );
                        })}
                      </div>
                    );
                  };

                  return renderTree(null, 0);
                })()}
              </div>
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {isFolderModalOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsFolderModalOpen(false)} className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="fixed inset-0 m-auto w-full max-w-sm h-fit bg-white rounded-3xl shadow-2xl z-[60] p-8 border border-neutral-200">
              <form onSubmit={editingFolder ? handleUpdateFolder : handleCreateFolder} className="space-y-6">
                <h2 className="text-2xl font-medium">{editingFolder ? 'Rename Folder' : 'New Folder'}</h2>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Folder Name</label>
                  <input 
                    autoFocus required type="text" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="e.g. Core Spanish" maxLength={50}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                  />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => { setIsFolderModalOpen(false); setEditingFolder(null); setNewFolderName(""); }} className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 font-medium hover:bg-neutral-50 transition-all text-neutral-600">Cancel</button>
                  <button disabled={saving} type="submit" className="flex-1 px-4 py-3 rounded-xl bg-black text-white font-medium hover:bg-neutral-800 transition-all disabled:opacity-50 flex justify-center">
                    {saving ? <Loader2 className="animate-spin" size={18} /> : (editingFolder ? 'Save' : 'Create')}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteConfirm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeleteConfirm(null)} className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="fixed inset-0 m-auto w-full max-w-sm h-fit bg-white rounded-3xl shadow-2xl z-[60] p-8 border border-neutral-200">
              <div className="space-y-6">
                <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-600">
                  <Trash2 size={24} />
                </div>
                <div>
                  <h2 className="text-2xl font-medium">Delete {deleteConfirm.type === 'folder' ? 'Folder' : 'Deck'}?</h2>
                  <p className="text-neutral-500 text-sm mt-2">
                    {deleteConfirm.type === 'folder' 
                      ? `Any decks inside "${deleteConfirm.name}" will be orphaned (moved to root). Cards won't be deleted.`
                      : `Are you sure you want to delete "${deleteConfirm.name}"? All cards will be lost.`}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 font-medium hover:bg-neutral-50 transition-all text-neutral-600">Cancel</button>
                  <button disabled={saving} onClick={() => {
                    if (deleteConfirm.type === 'folder') {
                      handleDeleteFolder(deleteConfirm.id).then(() => setDeleteConfirm(null));
                    } else {
                      handleDeleteDeck(deleteConfirm.id).then(() => setDeleteConfirm(null));
                    }
                  }} className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition-all disabled:opacity-50 flex justify-center">
                    {saving ? <Loader2 className="animate-spin" size={18} /> : 'Delete'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(isMovingDeck || isMovingFolder) && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setIsMovingDeck(null); setIsMovingFolder(null); }} className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[70]" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 m-auto w-full max-w-sm h-fit max-h-[80vh] overflow-y-auto bg-white rounded-3xl shadow-2xl z-[80] border border-neutral-200 p-6">
              <h3 className="text-xl font-medium mb-4">Move "{isMovingDeck ? isMovingDeck.title : isMovingFolder?.name}"</h3>
              <div className="space-y-2">
                <button 
                  onClick={() => isMovingDeck ? handleMoveDeck(isMovingDeck, null) : handleMoveFolder(isMovingFolder!, null)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${!(isMovingDeck || isMovingFolder)?.parentId ? "border-black bg-neutral-50 font-medium" : "border-neutral-100 hover:bg-neutral-50"}`}
                >
                  <Layers size={18} className="text-neutral-400" />
                  Top Level
                </button>
                {adminFolders.filter(f => !isMovingFolder || f.id !== isMovingFolder.id).map(f => ( // filter out itself if moving a folder
                  <button 
                    key={f.id}
                    onClick={() => isMovingDeck ? handleMoveDeck(isMovingDeck, f.id) : handleMoveFolder(isMovingFolder!, f.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${(isMovingDeck?.parentId === f.id || isMovingFolder?.parentId === f.id) ? "border-black bg-neutral-50 font-medium" : "border-neutral-100 hover:bg-neutral-50"}`}
                  >
                    <FolderIcon size={18} className="text-neutral-400" />
                    {f.name}
                  </button>
                ))}
                {isMovingDeck && adminDecks.filter(d => d.id !== isMovingDeck.id && d.parentId !== isMovingDeck.id).map(d => ( // Moving Deck inside a Deck
                  <button 
                    key={d.id}
                    onClick={() => handleMoveDeck(isMovingDeck, d.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${isMovingDeck.parentId === d.id ? "border-black bg-neutral-50 font-medium" : "border-neutral-100 hover:bg-neutral-50"}`}
                  >
                    <Layers size={18} className="text-neutral-400" />
                    {d.title}
                  </button>
                ))}
              </div>
              <button onClick={() => { setIsMovingDeck(null); setIsMovingFolder(null); }} className="w-full mt-6 py-3 text-sm text-neutral-500 font-medium hover:text-black transition-colors">Cancel</button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isFormOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsFormOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 m-auto w-full max-w-md h-fit bg-white rounded-3xl shadow-2xl z-[60] overflow-hidden border border-neutral-200"
            >
              <div className="p-8 space-y-6">
                <h2 className="text-2xl font-medium tracking-tight">Create Admin Deck</h2>
                
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Deck Title</label>
                    <input 
                      autoFocus
                      required
                      type="text" 
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="e.g. Core Spanish"
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                    />
                  </div>
                  
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Description</label>
                    <textarea 
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      rows={2}
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Tags</label>
                    <input 
                      type="text" 
                      value={tags}
                      onChange={e => setTags(e.target.value)}
                      placeholder="e.g. languages, beginner"
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Spaced Repetition Mode</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => setSrsMode('general')} type="button" className={`p-2 rounded-xl border-2 text-xs font-bold uppercase transition-all ${srsMode === 'general' ? 'border-black bg-neutral-100' : 'border-transparent bg-neutral-50 grayscale opacity-60'}`}>General</button>
                      <button onClick={() => setSrsMode('fast')} type="button" className={`p-2 rounded-xl border-2 text-xs font-bold uppercase transition-all ${srsMode === 'fast' ? 'border-orange-200 bg-orange-50 text-orange-600' : 'border-transparent bg-neutral-50 grayscale opacity-60'}`}>Fast</button>
                      <button onClick={() => setSrsMode('medical')} type="button" className={`p-2 rounded-xl border-2 text-xs font-bold uppercase transition-all ${srsMode === 'medical' ? 'border-indigo-200 bg-indigo-50 text-indigo-600' : 'border-transparent bg-neutral-50 grayscale opacity-60'}`}>Medical</button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 font-medium hover:bg-neutral-50 transition-all text-neutral-600"
                  >
                    Cancel
                  </button>
                  <button 
                    disabled={saving}
                    onClick={handleSaveNewDeck}
                    type="button"
                    className="flex-1 px-4 py-3 rounded-xl bg-black text-white font-medium hover:bg-neutral-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="animate-spin" size={18} /> : "Create Deck"}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// --------------------- ADMIN DECK DETAIL --------------------- //

const AdminDeckCardItem = React.memo(({ card, index, onEdit, onDelete }: { card: AdminCardDraft, index: number, onEdit: () => void, onDelete: () => void }) => {
  const [showMenu, setShowMenu] = useState(false);
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="group bg-white border border-neutral-200 hover:border-black px-4 py-3 sm:px-5 sm:py-4 flex flex-col transition-all shadow-sm rounded-xl sm:rounded-2xl relative"
    >
      <div className="flex w-full justify-between items-center mb-2">
        <div className="text-[10px] sm:text-xs font-mono text-neutral-400 font-bold bg-neutral-100 px-2 py-0.5 rounded-full uppercase tracking-widest">
          Card {index + 1}
        </div>
        <div className="flex items-center gap-1 relative">
          <button onClick={() => setShowMenu(!showMenu)} className="p-1 rounded-md hover:bg-neutral-200 text-neutral-400 hover:text-black transition-colors">
            <MoreVertical size={18} />
          </button>
          <AnimatePresence>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                  className="absolute right-0 top-8 bg-white rounded-xl shadow-xl border border-neutral-200 overflow-hidden w-36 z-50 origin-top-right"
                >
                  <button onClick={() => { setShowMenu(false); onEdit(); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-neutral-50 text-neutral-700"><Edit2 size={14} /> Edit</button>
                  <button onClick={() => { setShowMenu(false); onDelete(); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-red-50 text-red-600"><Trash2 size={14} /> Delete</button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="flex flex-col text-left">
        <p className="text-[14px] sm:text-[15px] font-medium leading-relaxed text-neutral-900 mb-1">
          <span className="font-bold mr-1">Q:</span>{card.front}
        </p>
        <p className="text-[13px] sm:text-[14px] leading-relaxed text-neutral-600 line-clamp-3 sm:line-clamp-none">
          <span className="font-bold mr-1">A:</span>{card.back}
        </p>
      </div>
    </motion.div>
  );
});

function AdminDeckDetail({ 
  deck, 
  onBack, 
  onUpdateDeck, 
  onPushDeck, 
  onDeleteDeck,
  pushing,
  showToast 
}: { 
  deck: AdminDeck, 
  onBack: () => void,
  onUpdateDeck: (updated: Partial<AdminDeck>) => void,
  onPushDeck: () => void,
  onDeleteDeck: () => void,
  pushing: boolean,
  showToast: (m: string, t: 'error' | 'success') => void
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");
  const [editingCard, setEditingCard] = useState<AdminCardDraft | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  
  const [showSettings, setShowSettings] = useState(false);
  const [isEditingDeck, setIsEditingDeck] = useState(false);
  const [editDeckTitle, setEditDeckTitle] = useState(deck.title);
  const [editDeckDesc, setEditDeckDesc] = useState(deck.description || "");

  const cards = deck.cards || [];
  const filteredCards = cards.filter(c => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q);
  });

  const saveDeckCards = async (newCards: AdminCardDraft[]) => {
    try {
      await updateDoc(doc(db, "admin_decks", deck.id), {
        cards: newCards,
        updatedAt: serverTimestamp()
      });
      onUpdateDeck({ cards: newCards });
    } catch(err) {
      showToast("Failed to save card changes", "error");
    }
  };

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFront.trim() || !newBack.trim()) return;
    const newCard = { id: Date.now().toString(), front: newFront, back: newBack };
    await saveDeckCards([...cards, newCard]);
    setNewFront(""); setNewBack(""); setIsAdding(false);
  };

  const handleUpdateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCard) return;
    const updated = cards.map(c => c.id === editingCard.id ? { ...c, front: editFront, back: editBack } : c);
    await saveDeckCards(updated);
    setEditingCard(null);
  };

  const handleDeleteCard = async (id: string) => {
    const updated = cards.filter(c => c.id !== id);
    await saveDeckCards(updated);
    setDeleteConfirmId(null);
  };

  const handleSaveDeckDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDeckTitle.trim()) return;
    try {
      await updateDoc(doc(db, "admin_decks", deck.id), {
        title: editDeckTitle.trim(),
        description: editDeckDesc.trim(),
        updatedAt: serverTimestamp()
      });
      onUpdateDeck({ title: editDeckTitle.trim(), description: editDeckDesc.trim() });
      setIsEditingDeck(false);
    } catch(err) {
      showToast("Failed to update deck details", "error");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-neutral-500 hover:text-black transition-colors">
          <ArrowLeft size={18} />
          <span className="font-medium">Back to List</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2.5 rounded-xl transition-all flex items-center gap-2 ${showSettings ? "bg-neutral-100 text-black shadow-inner" : "text-neutral-400 hover:text-black hover:bg-neutral-50"}`}
            >
              <Settings2 size={20} />
            </button>
            <AnimatePresence>
              {showSettings && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} />
                  <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} className="absolute right-0 mt-2 w-48 bg-white border border-neutral-200 rounded-2xl shadow-xl z-50 overflow-hidden">
                    <div className="p-2 space-y-1">
                      <button onClick={() => { setShowSettings(false); setIsEditingDeck(true); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 rounded-lg">
                        <Edit2 size={14} /> Edit Details
                      </button>
                      <button onClick={() => { setShowSettings(false); onDeleteDeck(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg">
                        <Trash2 size={14} /> Delete Deck
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <button 
            onClick={onPushDeck}
            disabled={pushing || cards.length === 0}
            className="hidden md:flex bg-black text-white px-6 py-2.5 rounded-xl font-medium shadow-sm hover:bg-neutral-800 transition-all active:scale-[0.98] items-center gap-2 disabled:opacity-30 disabled:grayscale"
          >
            {pushing ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            Push to All Users
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
            <div className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl text-sm font-bold uppercase tracking-tight shadow-sm border-2 ${
                  deck.srsMode === 'fast' ? "bg-orange-50 text-orange-600 border-orange-200" :
                  deck.srsMode === 'medical' ? "bg-indigo-50 text-indigo-600 border-indigo-200" :
                  "bg-neutral-50 text-neutral-600 border-neutral-200"
                }`}
            >
              <div className={`p-1.5 rounded-xl ${deck.srsMode === 'fast' ? "bg-orange-100" : deck.srsMode === 'medical' ? "bg-indigo-100" : "bg-neutral-200"}`}>
                 {deck.srsMode === 'fast' ? <Zap size={16} fill="currentColor" /> : deck.srsMode === 'medical' ? <Stethoscope size={16} /> : <Settings2 size={16} />}
              </div>
              <span className="pr-1">{deck.srsMode || 'General'}</span>
            </div>
          </div>
        </div>
        <p className="text-neutral-500">{deck.description || "Manage your flashcards for this global deck."}</p>
      </div>

      <div className="bg-white border md:border border-transparent md:border-neutral-200 md:rounded-3xl p-6 md:p-12 mb-4 flex flex-col items-center justify-center text-center space-y-4">
        <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-widest md:mb-2 border-b-2 border-transparent">total cards</h3>
        <div className="text-6xl md:text-[6rem] leading-none font-extrabold tracking-tighter text-neutral-900 mt-2">{cards.length}</div>
        <div className="flex flex-wrap items-center justify-center gap-4 mt-6">
          <div className="px-4 py-2 bg-neutral-50 rounded-xl text-sm text-neutral-600 border border-neutral-100">
            <span className="font-bold text-black mr-1">{deck.pushedToUsersCount || 0}</span> Users Pushed To
          </div>
          <div className="px-4 py-2 bg-neutral-50 rounded-xl text-sm text-neutral-600 border border-neutral-100 uppercase tracking-tight font-bold">
            {deck.isPublished ? <span className="text-green-600 tracking-normal">Published</span> : <span className="text-amber-600 tracking-normal">Draft</span>}
          </div>
        </div>
      </div>

      <div className="flex justify-center mb-8">
        <button 
          onClick={onPushDeck}
          disabled={pushing || cards.length === 0}
          className="bg-black w-full md:w-auto text-white px-8 py-3.5 rounded-2xl font-medium shadow-xl shadow-black/10 hover:bg-neutral-800 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-30 disabled:grayscale text-lg"
        >
          {pushing ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          Push deck to all
        </button>
      </div>

      <div className="pb-24">
        <div className="space-y-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search size={18} className="text-neutral-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by front text..."
              className="w-full bg-white border border-neutral-200 rounded-2xl pl-11 pr-4 py-3 outline-none focus:border-black transition-all text-sm shadow-sm"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
            <h3 className="font-medium text-neutral-400 text-sm">{filteredCards.length} Cards</h3>
          </div>

          {filteredCards.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-neutral-200">
              <Sparkles className="w-10 h-10 text-neutral-200 mx-auto mb-4" />
              <p className="text-neutral-400 text-sm">No cards found.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
              {filteredCards.map((card, idx) => (
                <AdminDeckCardItem 
                  key={card.id} 
                  card={card} 
                  index={idx}
                  onDelete={() => setDeleteConfirmId(card.id)}
                  onEdit={() => {
                    setEditingCard(card);
                    setEditFront(card.front);
                    setEditBack(card.back);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-8 left-0 right-0 flex justify-center z-40 pointer-events-none">
        <button
          onClick={() => setIsAdding(true)}
          className="pointer-events-auto bg-[#1C1C1E] text-white px-7 py-4 rounded-[2rem] font-medium shadow-2xl hover:bg-black hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3 text-[15px] tracking-wide"
        >
          Add cards
        </button>
      </div>

      {/* Edit Deck Title/Desc Modal */}
      <AnimatePresence>
        {isEditingDeck && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsEditingDeck(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-sm bg-white rounded-[2rem] p-6 shadow-2xl z-10 flex flex-col">
              <h3 className="text-xl font-semibold mb-6 px-1 text-center">Edit Deck Details</h3>
              <form onSubmit={handleSaveDeckDetails} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Title</label>
                  <input autoFocus required type="text" value={editDeckTitle} onChange={e => setEditDeckTitle(e.target.value)} className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 outline-none focus:border-black" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-500 uppercase">Description</label>
                  <textarea value={editDeckDesc} onChange={e => setEditDeckDesc(e.target.value)} rows={3} className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 outline-none focus:border-black resize-none" />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setIsEditingDeck(false)} className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 font-medium hover:bg-neutral-50 text-neutral-600">Cancel</button>
                  <button type="submit" className="flex-1 px-4 py-3 rounded-xl bg-black text-white font-medium hover:bg-neutral-800">Save</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAdding(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-lg bg-white rounded-[2rem] p-6 shadow-2xl z-10">
              <h3 className="text-xl font-semibold mb-6 px-1">Add cards</h3>
              <form onSubmit={handleAddCard} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 uppercase pl-1">Front (Question)</label>
                  <textarea required value={newFront} onChange={e => setNewFront(e.target.value)} rows={4} className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 outline-none focus:border-black focus:bg-white resize-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 uppercase pl-1">Back (Answer)</label>
                  <textarea required value={newBack} onChange={e => setNewBack(e.target.value)} rows={4} className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 outline-none focus:border-black focus:bg-white resize-none" />
                </div>
                <div className="flex justify-end gap-3 pt-6">
                  <button type="button" onClick={() => setIsAdding(false)} className="px-6 py-3.5 rounded-2xl font-medium text-neutral-600 hover:bg-neutral-100">Cancel</button>
                  <button type="submit" className="bg-black text-white px-8 py-3.5 rounded-2xl font-medium shadow-lg hover:bg-neutral-800 flex items-center gap-2"><MessageSquarePlus size={18} /> Save Card</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingCard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingCard(null)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-lg bg-white rounded-[2rem] p-6 shadow-2xl z-10">
              <h3 className="text-xl font-semibold mb-6 px-1">Edit Card</h3>
              <form onSubmit={handleUpdateCard} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 uppercase pl-1">Front (Question)</label>
                  <textarea required value={editFront} onChange={e => setEditFront(e.target.value)} rows={4} className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 outline-none focus:border-black focus:bg-white resize-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-neutral-500 uppercase pl-1">Back (Answer)</label>
                  <textarea required value={editBack} onChange={e => setEditBack(e.target.value)} rows={4} className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 outline-none focus:border-black focus:bg-white resize-none" />
                </div>
                <div className="flex justify-end gap-3 pt-6">
                  <button type="button" onClick={() => setEditingCard(null)} className="px-6 py-3.5 rounded-2xl font-medium text-neutral-600 hover:bg-neutral-100">Cancel</button>
                  <button type="submit" className="bg-black text-white px-8 py-3.5 rounded-2xl font-medium shadow-lg hover:bg-neutral-800 focus:outline-none">Save Changes</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteConfirmId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeleteConfirmId(null)} className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl z-10 border border-neutral-200 text-center">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-red-600 mx-auto mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-xl font-medium mb-2">Delete Card?</h3>
              <p className="text-neutral-500 text-sm mb-6">Are you sure you want to delete this card? This action cannot be undone.</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setDeleteConfirmId(null)} className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 font-medium hover:bg-neutral-50">Cancel</button>
                <button onClick={() => handleDeleteCard(deleteConfirmId)} className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700">Delete</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
