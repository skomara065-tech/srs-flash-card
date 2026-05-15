import { useState, useEffect, useRef } from "react";
import { auth, logAnalyticsEvent } from "./lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { Layout } from "./components/Layout";
import { Dashboard } from "./components/Dashboard";
import { StudyView } from "./components/StudyView";
import { DeckDetail } from "./components/DeckDetail";
import { AdminPanel } from "./components/AdminPanel";
import { Deck, Folder } from "./types";
import { collection, query, where, getDocs, setDoc, doc } from "firebase/firestore";
import { db } from "./lib/firebase";
import { useAdmin } from "./hooks/useAdmin";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDeck, setActiveDeck] = useState<Deck | null>(null);
  const [view, setView] = useState<'dashboard' | 'detail' | 'study' | 'admin'>('dashboard');
  const [cameFromStudy, setCameFromStudy] = useState(false);
  const [deckWasReset, setDeckWasReset] = useState(false);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [viewFolderId, setViewFolderId] = useState<string | null>(null);
  const [decksLoading, setDecksLoading] = useState(true);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const hasFetched = useRef(false);

  const { isAdmin, adminLoading } = useAdmin(user);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          await setDoc(doc(db, "users", u.uid), {
            uid: u.uid,
            email: u.email || "",
            displayName: u.displayName || "",
            photoURL: u.photoURL || ""
          }, { merge: true });
        } catch (err) {
          console.error("Failed to save user doc", err);
        }

        if (!hasFetched.current) {
          fetchAll(u.uid);
          hasFetched.current = true;
        }
      } else {
        hasFetched.current = false;
        setDecks([]);
        setFolders([]);
        setViewFolderId(null);
        setDecksLoading(false);
        setFoldersLoading(false);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const fetchAll = async (uid: string) => {
    setDecksLoading(true);
    setFoldersLoading(true);
    try {
      const decksQ = query(
        collection(db, "decks"),
        where("userId", "==", uid)
      );
      const decksSnap = await getDocs(decksQ);
      const fetchedDecks = decksSnap.docs.map(d => ({ id: d.id, ...d.data() } as Deck))
        .sort((a, b) => {
          const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
          const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
          return dateB.getTime() - dateA.getTime();
        });
      setDecks(fetchedDecks);
    } catch (err) {
      console.error("Fetch decks failed:", err);
    } finally {
      setDecksLoading(false);
    }

    try {
      const foldersQ = query(
        collection(db, "folders"),
        where("userId", "==", uid)
      );
      const foldersSnap = await getDocs(foldersQ);
      const fetchedFolders = foldersSnap.docs.map(f => ({ id: f.id, ...f.data() } as Folder))
        .sort((a, b) => {
          const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
          const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
          return dateB.getTime() - dateA.getTime();
        });
      setFolders(fetchedFolders);
    } catch (err) {
      console.error("Fetch folders failed:", err);
    } finally {
      setFoldersLoading(false);
    }
    setLoading(false);
  };

  const handleSelectDeck = (deck: Deck) => {
    setActiveDeck(deck);
    setView('detail');
  };

  const handleUpdateDeck = (updatedFields: Partial<Deck>) => {
    if (activeDeck) {
      const newActiveDeck = { ...activeDeck, ...updatedFields } as Deck;
      setActiveDeck(newActiveDeck);
      
      // Sync the decks list as well
      setDecks(prev => prev.map(d => d.id === activeDeck.id ? newActiveDeck : d));
    }
  };

  return (
    <Layout 
      user={user} 
      loading={loading || adminLoading} 
      hideSidebar={view === 'study'}
      folders={folders}
      decks={decks}
      onSelectDeck={handleSelectDeck}
      viewFolderId={viewFolderId}
      setViewFolderId={(id) => {
        setViewFolderId(id);
        setView('dashboard');
        setActiveDeck(null);
      }}
      isAdmin={isAdmin}
      onAdminClick={() => {
        setView('admin');
        setActiveDeck(null);
        setViewFolderId(null);
      }}
      currentView={view}
    >
      {view === 'dashboard' && (
        <Dashboard 
          onSelectDeck={handleSelectDeck} 
          decks={decks} 
          setDecks={setDecks} 
          folders={folders}
          setFolders={setFolders}
          viewFolderId={viewFolderId}
          setViewFolderId={setViewFolderId}
          loading={decksLoading || foldersLoading} 
          setLoading={(val) => { setDecksLoading(val); setFoldersLoading(val); }}
          isAdmin={isAdmin}
          onDeckCreated={() => {
            logAnalyticsEvent('deck_created');
          }}
        />
      )}
      
      {view === 'detail' && activeDeck && (
        <DeckDetail 
          deck={activeDeck} 
          allDecks={decks}
          onBack={() => { 
            setView('dashboard'); 
            setCameFromStudy(false);
            setActiveDeck(null); 
          }} 
          onStudy={() => {
            setCameFromStudy(false);
            setView('study');
            logAnalyticsEvent('study_session_started', { deckId: activeDeck.id, srsMode: activeDeck.srsMode });
          }} 
          onUpdateDeck={handleUpdateDeck}
          forceRefresh={cameFromStudy}
          onReset={() => setDeckWasReset(true)}
          isAdmin={isAdmin}
        />
      )}

      {view === 'study' && activeDeck && (
        <StudyView 
          deck={activeDeck} 
          allDecks={decks}
          onBack={() => {
            setView('detail');
            setCameFromStudy(true);
            setDeckWasReset(false);
          }} 
          forceRefresh={deckWasReset}
        />
      )}

      {view === 'admin' && isAdmin && (
        <AdminPanel onBack={() => {
          setView('dashboard');
          setViewFolderId(null);
        }} />
      )}
    </Layout>
  );
}
