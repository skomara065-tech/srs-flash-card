import * as React from "react";
import { useState, useEffect } from "react";
import { collection, query, where, getDocs, addDoc, serverTimestamp, orderBy, getDoc, doc, writeBatch } from "firebase/firestore";
import { db, auth, handleFirestoreError, OperationType } from "../lib/firebase";
import { Deck, SRSMode, Folder } from "../types";
import { Plus, Search, Layers, Clock, ArrowRight, BrainCircuit, Loader2, Zap, Stethoscope, Settings2, FolderPlus, Folder as FolderIcon, ChevronLeft, ChevronRight, ChevronDown, MoreHorizontal, Move, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { updateDoc, deleteDoc } from "firebase/firestore";

export interface DashboardProps {
  onSelectDeck: (deck: Deck) => void;
  decks: Deck[];
  setDecks: React.Dispatch<React.SetStateAction<Deck[]>>;
  folders: Folder[];
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  viewFolderId: string | null;
  setViewFolderId: (id: string | null) => void;
  loading: boolean;
  setLoading: (val: boolean) => void;
  isAdmin?: boolean;
  onDeckCreated?: () => void;
}

export function Dashboard({ onSelectDeck, decks, setDecks, folders, setFolders, viewFolderId, setViewFolderId, loading, setLoading, isAdmin, onDeckCreated }: DashboardProps) {
  const dueCounts = React.useMemo(() => {
    return Object.fromEntries(decks.map(d => [d.id, d.dueCounts?.[d.srsMode] || 0]));
  }, [decks]);
  const [isDeckModalOpen, setIsDeckModalOpen] = useState(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [newDeckTitle, setNewDeckTitle] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [parentFolderIdForNew, setParentFolderIdForNew] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [srsMode, setSrsMode] = useState<SRSMode>("general");
  const [error, setError] = useState<string | null>(null);
  const [isMovingDeck, setIsMovingDeck] = useState<Deck | null>(null);
  const [isMovingFolder, setIsMovingFolder] = useState<Folder | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{type: 'folder' | 'deck', id: string, name: string} | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

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
    if (!auth.currentUser || !newFolderName.trim()) return;

    try {
      setLoading(true);
      const folderData = {
        userId: auth.currentUser.uid,
        name: newFolderName,
        parentId: parentFolderIdForNew || null,
        createdAt: serverTimestamp(),
      };
      const folderRef = await addDoc(collection(db, "folders"), folderData);
      
      const createdFolder: Folder = {
        id: folderRef.id,
        ...folderData,
        createdAt: new Date(),
      } as Folder;

      setFolders(prev => [createdFolder, ...prev]);
      setNewFolderName("");
      setIsFolderModalOpen(false);
      setParentFolderIdForNew(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "folders");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !editingFolder || !newFolderName.trim()) return;

    try {
      setLoading(true);
      await updateDoc(doc(db, "folders", editingFolder.id), {
        name: newFolderName,
        updatedAt: serverTimestamp()
      });
      setFolders(prev => prev.map(f => f.id === editingFolder.id ? { ...f, name: newFolderName } : f));
      setEditingFolder(null);
      setNewFolderName("");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `folders/${editingFolder.id}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      setLoading(true);
      // 1. Delete the folder
      const batch = writeBatch(db);
      batch.delete(doc(db, "folders", folderId));

      // 2. Orphan the decks in that folder
      const decksInFolder = decks.filter(d => d.folderId === folderId);
      decksInFolder.forEach(d => {
        batch.update(doc(db, "decks", d.id), {
          folderId: "",
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();

      setFolders(prev => prev.filter(f => f.id !== folderId));
      setDecks(prev => prev.map(d => d.folderId === folderId ? { ...d, folderId: "" } : d));
      if (viewFolderId === folderId) setViewFolderId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `folders/${folderId}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !newDeckTitle.trim()) return;

    try {
      setLoading(true);
      setError(null);
      const deckData = {
        userId: auth.currentUser.uid,
        parentId: selectedFolderId || viewFolderId || null,
        title: newDeckTitle,
        description: "",
        cardCount: 0,
        srsMode: srsMode,
        lastCardNumber: 0,
        createdAt: serverTimestamp(),
      };
      
      const deckRef = await addDoc(collection(db, "decks"), deckData);
      
      const createdDeck: Deck = {
        id: deckRef.id,
        ...deckData,
        createdAt: new Date(),
      } as Deck;

      setDecks(prev => [createdDeck, ...prev]);
      onDeckCreated?.();
      setNewDeckTitle("");
      setSrsMode("general");
      setIsDeckModalOpen(false);
      setSelectedFolderId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create deck.");
      handleFirestoreError(err, OperationType.WRITE, "decks");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDeck = async (deckId: string) => {
    try {
      setLoading(true);
      await deleteDoc(doc(db, "decks", deckId));
      setDecks(prev => prev.filter(d => d.id !== deckId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `decks/${deckId}`);
    } finally {
      setLoading(false);
      setDeleteConfirm(null);
    }
  };

  const handleMoveDeck = async (deck: Deck, parentId: string | null) => {
    try {
      await updateDoc(doc(db, "decks", deck.id), {
        parentId: parentId || null,
        updatedAt: serverTimestamp()
      });
      setDecks(prev => prev.map(d => d.id === deck.id ? { ...d, parentId: parentId || undefined } : d));
      setIsMovingDeck(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `decks/${deck.id}`);
    }
  };

  const handleMoveFolder = async (folder: Folder, parentId: string | null) => {
    try {
      await updateDoc(doc(db, "folders", folder.id), {
        parentId: parentId || null,
        updatedAt: serverTimestamp()
      });
      setFolders(prev => prev.map(f => f.id === folder.id ? { ...f, parentId: parentId || null } : f));
      setIsMovingFolder(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `folders/${folder.id}`);
    }
  };

  const currentFolder = folders.find(f => f.id === viewFolderId);
  
  const filteredDecks = searchQuery.trim() 
    ? decks.filter(d => d.title.toLowerCase().includes(searchQuery.toLowerCase()) || d.description?.toLowerCase().includes(searchQuery.toLowerCase()))
    : decks;

  const displayedDecks = filteredDecks;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-2 border-b border-neutral-100">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-medium tracking-tight text-neutral-900 leading-none">
              All Decks
            </h2>
          </div>
          <p className="text-neutral-500 mt-2 text-sm">
            Manage and organize your learning library.
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative group/search flex-1 md:w-72 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 group-focus-within/search:text-black transition-colors" size={16} />
            <input 
              type="text" 
              placeholder="Search items..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-xl pl-9 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
            />
          </div>
          {isAdmin && (
            <button 
              onClick={() => setIsDeckModalOpen(true)}
              className="bg-black text-white rounded-xl px-5 py-2 text-sm font-medium flex items-center gap-2 hover:bg-neutral-800 transition-all active:scale-[0.98] shadow-sm"
            >
              <Plus size={18} />
              Create Deck
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3].map(i => (
            <div key={i} className="h-48 rounded-2xl bg-white border border-neutral-200 animate-pulse" />
          ))}
        </div>
      ) : (decks.length === 0 && folders.length === 0) ? (
        <div className="text-center py-24 bg-white rounded-3xl border border-dashed border-neutral-200">
          <Layers className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium">Your library is empty</h3>
          <p className="text-neutral-500 max-w-xs mx-auto">Create a folder or your first deck to get started.</p>
        </div>
      ) : (
        <div className="space-y-12">
          {/* Flat or Tree View */}
          <div className="space-y-4">
            {searchQuery ? (
              <div className="flex flex-col border-t border-b border-neutral-100 divide-y divide-neutral-100">
                {displayedDecks.length === 0 ? (
                  <div className="text-center py-12 bg-neutral-50/50 rounded-2xl border border-dashed border-neutral-200">
                    <p className="text-neutral-400 text-sm italic">No decks match your search.</p>
                  </div>
                ) : (
                  displayedDecks.map(deck => {
                    const dueCount = dueCounts[deck.id] || 0;
                    return (
                      <div
                        key={deck.id}
                        onClick={() => onSelectDeck(deck)}
                        className="group relative py-4 flex flex-row items-center justify-between cursor-pointer hover:bg-neutral-50 transition-colors px-2"
                      >
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-neutral-900 truncate text-base">{deck.title}</h4>
                          <p className="text-sm text-neutral-500">Cards to study: {dueCount > 0 ? dueCount : deck.cardCount || 0}</p>
                        </div>
                        <ChevronRight size={20} className="text-neutral-300" />
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="flex flex-col border-t border-b border-neutral-100 divide-y divide-neutral-100">
                {(() => {
                  const renderTree = (parentId: string | null = null, depth = 0): React.ReactNode => {
                    const treeFolders = folders.filter(f => f.parentId === parentId || (parentId === null && !f.parentId));
                    const treeDecks = decks.filter(d => (d.parentId || d.folderId || null) === parentId);

                    return (
                      <div className={`flex flex-col divide-y divide-neutral-100 w-full ${depth > 0 ? "ml-4 border-l border-neutral-100 pl-4 py-1" : ""}`}>
                        {treeFolders.map(folder => {
                          const isExpanded = expandedFolders.has(folder.id);
                          const hasChildren = folders.some(f => f.parentId === folder.id) || decks.some(d => (d.parentId || d.folderId) === folder.id);
                          const deckCount = decks.filter(d => (d.parentId || d.folderId) === folder.id).length;

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
                                  onClick={(e) => hasChildren ? toggleFolder(folder.id, e as any) : undefined}
                                  className="flex-1 py-4 flex flex-row items-center justify-between"
                                >
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-semibold text-neutral-900 truncate text-base">{folder.name} <span className="text-xs bg-neutral-200 px-1 py-0.5 rounded text-neutral-600">Folder</span></h4>
                                    <p className="text-sm text-neutral-500">{deckCount} {deckCount === 1 ? 'item' : 'items'}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                                  {isAdmin && (
                                    <>
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); setParentFolderIdForNew(folder.id); setIsDeckModalOpen(true); }}
                                        className="p-2 hover:bg-neutral-200 rounded-lg text-neutral-400 hover:text-black transition-colors" title="New Subdeck"
                                      >
                                        <FolderPlus size={16} />
                                      </button>
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: 'folder', id: folder.id, name: folder.name }); }}
                                        className="p-2 hover:bg-red-50 rounded-lg text-neutral-400 hover:text-red-500 transition-colors" title="Delete folder"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </>
                                  )}
                                  <ChevronRight size={20} className="text-neutral-300 md:hidden ml-1" />
                                </div>
                              </div>
                              {isExpanded && hasChildren && renderTree(folder.id, depth + 1)}
                            </div>
                          );
                        })}

                        {treeDecks.map(deck => {
                          const isExpanded = expandedFolders.has(deck.id);
                          const hasChildren = decks.some(d => d.parentId === deck.id);
                          
                          // Recursively get all children to compute total cards
                          const getAggregatedCounts = (id: string, visited = new Set<string>()): { due: number, total: number } => {
                            if (visited.has(id)) return { due: 0, total: 0 };
                            visited.add(id);
                            
                            const d = decks.find(dk => dk.id === id);
                            if (!d) return { due: 0, total: 0 };
                            
                            let due = d.dueCounts?.[d.srsMode] || 0;
                            let total = d.cardCount || 0;
                            
                            const children = decks.filter(cd => cd.parentId === id);
                            for (const c of children) {
                              const cc = getAggregatedCounts(c.id, visited);
                              due += cc.due;
                              total += cc.total;
                            }
                            return { due, total };
                          };
                          
                          const counts = getAggregatedCounts(deck.id);

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
                                  onClick={() => onSelectDeck(deck)}
                                  className="flex-1 py-4 flex flex-row items-center justify-between"
                                >
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-semibold text-neutral-900 truncate text-base">{deck.title}</h4>
                                    <p className="text-sm text-neutral-500">Cards to study: {counts.due > 0 ? counts.due : counts.total}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                                  {isAdmin && (
                                    <>
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); setParentFolderIdForNew(deck.id); setIsDeckModalOpen(true); }}
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
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: 'deck', id: deck.id, name: deck.title }); }}
                                        className="p-2 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-all" title="Delete deck"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </>
                                  )}
                                  <ChevronRight size={20} className="text-neutral-300 md:hidden ml-1" />
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
            )}
          </div>
        </div>
      )}

      {/* Folder Rename/Edit Modal */}
      <AnimatePresence>
        {editingFolder && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingFolder(null)} className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="fixed inset-0 m-auto w-full max-w-sm h-fit bg-white rounded-3xl shadow-2xl z-[60] p-8 border border-neutral-200">
              <form onSubmit={handleUpdateFolder} className="space-y-6">
                <h2 className="text-2xl font-medium">Rename Folder</h2>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Folder Name</label>
                  <input 
                    autoFocus required type="text" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="e.g. University Notes" maxLength={50}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                  />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setEditingFolder(null)} className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 font-medium hover:bg-neutral-50 transition-all text-neutral-600">Cancel</button>
                  <button disabled={loading} type="submit" className="flex-1 px-4 py-3 rounded-xl bg-black text-white font-medium hover:bg-neutral-800 transition-all disabled:opacity-50">Save</button>
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
                      ? `Any decks inside "${deleteConfirm.name}" will be moved back to the root library. Cards won't be deleted.`
                      : `Are you sure you want to delete "${deleteConfirm.name}"? All cards inside it will be lost.`}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 font-medium hover:bg-neutral-50 transition-all text-neutral-600">Cancel</button>
                  <button disabled={loading} onClick={() => {
                    if (deleteConfirm.type === 'folder') {
                      handleDeleteFolder(deleteConfirm.id).then(() => setDeleteConfirm(null));
                    } else {
                      handleDeleteDeck(deleteConfirm.id);
                    }
                  }} className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition-all disabled:opacity-50 flex justify-center">{loading ? <Loader2 className="animate-spin" size={18} /> : 'Delete'}</button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      
      <AnimatePresence>
        {isMovingDeck && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsMovingDeck(null)} className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[70]" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 m-auto w-full max-w-sm h-fit bg-white rounded-3xl shadow-2xl z-[80] overflow-hidden border border-neutral-200 p-6">
              <h3 className="text-xl font-medium mb-4">Move "{isMovingDeck.title}"</h3>
              <div className="space-y-2">
                <button 
                  onClick={() => handleMoveDeck(isMovingDeck, null)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${!isMovingDeck.parentId ? "border-black bg-neutral-50 font-medium" : "border-neutral-100 hover:bg-neutral-50"}`}
                >
                  <Layers size={18} className="text-neutral-400" />
                  Top Level
                </button>
                {folders.map(f => (
                  <button 
                    key={f.id}
                    onClick={() => handleMoveDeck(isMovingDeck, f.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${(isMovingDeck.parentId || isMovingDeck.folderId) === f.id ? "border-black bg-neutral-50 font-medium" : "border-neutral-100 hover:bg-neutral-50"}`}
                  >
                    <FolderIcon size={18} className="text-neutral-400" />
                    {f.name}
                  </button>
                ))}
                {decks.filter(d => d.id !== isMovingDeck.id && d.parentId !== isMovingDeck.id).map(d => (
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
              <button onClick={() => setIsMovingDeck(null)} className="w-full mt-6 py-3 text-sm text-neutral-500 font-medium hover:text-black transition-colors">Cancel</button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Folder Creation Modal */}
      <AnimatePresence>
        {isFolderModalOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsFolderModalOpen(false)} className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="fixed inset-0 m-auto w-full max-w-sm h-fit bg-white rounded-3xl shadow-2xl z-[60] p-8 border border-neutral-200">
              <form onSubmit={handleCreateFolder} className="space-y-6">
                <h2 className="text-2xl font-medium">New Folder</h2>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Folder Name</label>
                  <input 
                    autoFocus required type="text" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="e.g. University Notes" maxLength={50}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                  />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setIsFolderModalOpen(false)} className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 font-medium hover:bg-neutral-50 transition-all text-neutral-600">Cancel</button>
                  <button disabled={loading} type="submit" className="flex-1 px-4 py-3 rounded-xl bg-black text-white font-medium hover:bg-neutral-800 transition-all disabled:opacity-50">Create</button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Deck Creation Modal */}
      <AnimatePresence>
        {isDeckModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDeckModalOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 m-auto w-full max-w-lg h-fit bg-white rounded-3xl shadow-2xl z-[60] overflow-hidden border border-neutral-200"
            >
              <form onSubmit={handleCreateDeck} className="p-8 space-y-6">
                <h2 className="text-2xl font-medium tracking-tight">Create New Deck</h2>
                
                {error && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                    {error}
                  </div>
                )}

                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Deck Title</label>
                    <input 
                      autoFocus
                      required
                      type="text" 
                      value={newDeckTitle}
                      onChange={e => setNewDeckTitle(e.target.value)}
                      placeholder="e.g. Modern Architecture"
                      maxLength={100}
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Parent (Optional)</label>
                    <select 
                      value={selectedFolderId || ""} 
                      onChange={e => setSelectedFolderId(e.target.value || null)}
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 outline-none appearance-none"
                    >
                      <option value="">Top Level</option>
                      <optgroup label="Folders">
                        {folders.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Decks">
                        {decks.map(d => (
                          <option key={d.id} value={d.id}>{d.title}</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Spaced Repetition Mode</label>
                    <div className="grid grid-cols-3 gap-2">
                      <ModeButton 
                        active={srsMode === 'general'} 
                        onClick={() => setSrsMode('general')}
                        icon={<Settings2 size={14} />}
                        label="General"
                      />
                      <ModeButton 
                        active={srsMode === 'fast'} 
                        onClick={() => setSrsMode('fast')}
                        icon={<Zap size={14} />}
                        label="Fast"
                        color="text-orange-600 bg-orange-50 border-orange-200"
                      />
                      <ModeButton 
                        active={srsMode === 'medical'} 
                        onClick={() => setSrsMode('medical')}
                        icon={<Stethoscope size={14} />}
                        label="Medical"
                        color="text-indigo-600 bg-indigo-50 border-indigo-200"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsDeckModalOpen(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 font-medium hover:bg-neutral-50 transition-all text-neutral-600"
                  >
                    Cancel
                  </button>
                  <button 
                    disabled={loading}
                    type="submit"
                    className="flex-1 px-4 py-3 rounded-xl bg-black text-white font-medium hover:bg-neutral-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading && <Loader2 className="animate-spin" size={18} />}
                    Create Deck
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModeButton({ active, label, icon, onClick, color = "text-black bg-neutral-50 border-neutral-200" }: { active: boolean, label: string, icon: React.ReactNode, onClick: () => void, color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
        active 
          ? (color.includes("text-black") ? "border-black bg-neutral-100" : color.replace("border-", "border-opacity-100 border-")) 
          : "border-transparent bg-neutral-50 grayscale opacity-60"
      }`}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tight">{label}</span>
    </button>
  );
}
