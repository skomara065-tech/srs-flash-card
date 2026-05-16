import * as React from "react";
import { ReactNode, useState, useEffect } from "react";
import { auth, signInWithGoogle, signOut } from "../lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { LogOut, BookOpen, LayoutDashboard, Loader2, Folder as FolderIcon, ChevronRight, ChevronDown, Layers, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Folder, Deck } from "../types";

interface LayoutProps {
  children: ReactNode;
  user: User | null;
  loading: boolean;
  hideSidebar?: boolean;
  folders?: Folder[];
  decks?: Deck[];
  onSelectDeck?: (deck: Deck) => void;
  viewFolderId?: string | null;
  setViewFolderId?: (id: string | null) => void;
  isAdmin?: boolean;
  onAdminClick?: () => void;
  currentView?: string;
}

export function Layout({ children, user, loading, hideSidebar, folders = [], decks = [], onSelectDeck, viewFolderId, setViewFolderId, isAdmin, onAdminClick, currentView }: LayoutProps) {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const toggleFolder = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: !prev[folderId]
    }));
  };
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5]">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <Loader2 className="w-8 h-8 text-neutral-400" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-sm border border-neutral-200">
              <BookOpen className="w-8 h-8 text-black" />
            </div>
            <h1 className="text-4xl font-sans font-medium tracking-tight text-neutral-900">Recall</h1>
            <p className="text-neutral-500 font-sans"> मास्टर your learning with AI-powered spaced repetition.</p>
          </div>
          
          <div className="space-y-3">
            <button
              onClick={signInWithGoogle}
              className="w-full bg-black text-white rounded-xl py-4 px-6 font-medium shadow-xl hover:bg-neutral-800 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
            >
              <img src="https://www.google.com/favicon.ico" className="w-5 h-5 invert" alt="Google" />
              Sign in with Google
            </button>
            <p className="text-xs text-neutral-400 text-center">
              Admins will see their dashboard automatically after signing in.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex overflow-hidden">
      {/* Sidebar */}
      {!hideSidebar && (
        <aside className="w-64 border-r border-neutral-200 bg-white flex flex-col h-screen sticky top-0 hidden md:flex">
          <div className="p-6">
            <div className="flex items-center gap-3">
              <BookOpen className="w-6 h-6 text-black" />
              <span className="font-medium text-lg tracking-tight">Recall</span>
            </div>
          </div>
          
          <nav className="flex-1 px-4 space-y-6 overflow-y-auto pt-4">
            <div className="space-y-1">
              <NavItem 
                icon={<LayoutDashboard size={18} />} 
                label="All Decks" 
                active={viewFolderId === null} 
                onClick={() => setViewFolderId?.(null)}
              />
            </div>

            <div className="space-y-2">
              <div className="px-3 flex items-center justify-between">
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Your Folders</span>
              </div>
              <div className="space-y-1">
                {folders.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-neutral-400 italic">No folders yet</p>
                ) : (
                  folders.map(folder => {
                    const folderDecks = decks.filter(d => d.folderId === folder.id);
                    const isExpanded = expandedFolders[folder.id];
                    
                    return (
                      <div key={folder.id} className="space-y-0.5">
                        <div 
                          role="button"
                          tabIndex={0}
                          onClick={() => setViewFolderId?.(folder.id)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer group ${
                            viewFolderId === folder.id ? "bg-neutral-900 text-white shadow-lg shadow-black/5" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
                          }`}
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <span className={viewFolderId === folder.id ? "text-white" : "text-neutral-400 group-hover:text-neutral-900"}>
                              <FolderIcon size={16} />
                            </span>
                            <span className="truncate">{folder.name}</span>
                          </div>
                          
                          {folderDecks.length > 0 && (
                            <button
                              onClick={(e) => toggleFolder(folder.id, e)}
                              className={`p-1 rounded-md transition-colors ${viewFolderId === folder.id ? 'hover:bg-white/20' : 'hover:bg-neutral-200'}`}
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          )}
                        </div>
                        
                        <AnimatePresence>
                          {isExpanded && folderDecks.length > 0 && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="pt-1 pb-2 pl-9 pr-2 space-y-1 border-l-2 border-neutral-100 ml-4">
                                {folderDecks.map(deck => (
                                  <button
                                    key={deck.id}
                                    onClick={() => onSelectDeck?.(deck)}
                                    className="w-full text-left px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 rounded-md transition-colors truncate flex items-center gap-2"
                                  >
                                    <Layers size={12} className="shrink-0 opacity-50" />
                                    <span className="truncate">{deck.title}</span>
                                  </button>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </nav>

          <div className="p-4 border-t border-neutral-100">
            {isAdmin && (
              <button
                onClick={onAdminClick}
                className="w-full flex items-center gap-3 px-3 py-2 mb-2 rounded-lg text-sm font-medium transition-all bg-amber-50 text-amber-700 hover:bg-amber-100"
              >
                <ShieldCheck size={18} />
                <span className="flex-1 text-left">Admin Dashboard</span>
                <span className="text-[10px] font-bold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-md">DEV</span>
              </button>
            )}
            <div className="flex items-center gap-3 p-3 mb-2">
              <img src={user.photoURL || undefined} className="w-8 h-8 rounded-full bg-neutral-100 border border-neutral-200" alt={user.displayName || "User"} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.displayName}</p>
                <p className="text-xs text-neutral-500 truncate">{user.email}</p>
              </div>
            </div>
            <button 
              onClick={signOut}
              className="w-full text-left flex items-center gap-3 px-3 py-2 text-sm text-neutral-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut size={16} />
              Sign Out
            </button>
          </div>
        </aside>
      )}

      {/* Main Content */}
      <main className={`flex-1 overflow-y-auto h-screen relative ${hideSidebar ? "w-full" : ""}`}>
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-neutral-200 p-4 flex items-center justify-between md:hidden">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            <span className="font-medium truncate max-w-[150px]">
              {currentView === 'admin'
                ? 'Admin Dashboard'
                : viewFolderId
                  ? folders.find(f => f.id === viewFolderId)?.name
                  : 'Recall'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {viewFolderId && (
              <button 
                onClick={() => setViewFolderId?.(null)}
                className="text-xs font-bold text-neutral-400 uppercase tracking-tight hover:text-black"
              >
                Back
              </button>
            )}
            {isAdmin && (
              <button onClick={onAdminClick} className="text-amber-500 hover:text-amber-600 transition-colors">
                <ShieldCheck size={20} />
              </button>
            )}
            <button onClick={signOut} className="text-neutral-500">
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <div className={`${hideSidebar ? "max-w-6xl" : "max-w-5xl"} mx-auto p-4 md:p-8`}>
          {children}
        </div>
      </main>
    </div>
  );
}

interface NavItemProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active = false, onClick }) => {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
        active ? "bg-neutral-900 text-white shadow-lg shadow-black/5" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
      }`}
    >
      <span className={active ? "text-white" : "text-neutral-400 group-hover:text-neutral-900"}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
