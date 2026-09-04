"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";

import { emptyFeedState, type FeedState } from "./feed-state";

export type FeedKind = "discovery" | "following";
type WorkspaceState = Record<FeedKind, FeedState>;

type FeedWorkspaceValue = {
  restored: boolean;
  states: WorkspaceState;
  setFeedState: (kind: FeedKind, update: SetStateAction<FeedState>) => void;
  rememberScroll: (kind: FeedKind, scrollY: number) => void;
  scrollFor: (kind: FeedKind) => number;
  saveDiscoveryForLogin: () => void;
  saveForBrowse: (kind: FeedKind, scrollY: number, focusTarget: string) => void;
  restoredFocus: string | undefined;
  clearRestoredFocus: () => void;
};

const resumeStorageKey = "sevo:buyer-feeds:login-resume";
const FeedWorkspaceContext = createContext<FeedWorkspaceValue | undefined>(undefined);
type BrowseResume = {
  states: WorkspaceState;
  scrollPositions: Record<FeedKind, number>;
  focusTarget: string;
};

// This deliberately lives only in the current JavaScript document: it survives a
// client-side detail visit, but is never written to persistent browser storage.
// The location-based login path below persists discovery state only.
let browseResume: BrowseResume | undefined;

export function FeedWorkspace({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<WorkspaceState>(freshWorkspace);
  const [restored, setRestored] = useState(false);
  const [restoredFocus, setRestoredFocus] = useState<string>();
  const scrollPositions = useRef<Record<FeedKind, number>>({
    discovery: 0,
    following: 0,
  });

  useEffect(() => {
    if (browseResume) {
      const snapshot = browseResume;
      browseResume = undefined;
      scrollPositions.current = snapshot.scrollPositions;
      setStates(snapshot.states);
      setRestoredFocus(snapshot.focusTarget);
      setRestored(true);
      return;
    }
    const saved = sessionStorage.getItem(resumeStorageKey);
    sessionStorage.removeItem(resumeStorageKey);
    if (saved) {
      try {
        const snapshot = JSON.parse(saved) as { discovery?: FeedState };
        if (!snapshot.discovery) throw new Error("missing discovery state");
        scrollPositions.current = {
          discovery: snapshot.discovery.scrollY,
          following: 0,
        };
        setStates({
          discovery: snapshot.discovery,
          following: { ...emptyFeedState },
        });
      } catch {
        // Ignore a damaged, browser-local resume snapshot and load fresh data.
      }
    }
    setRestored(true);
  }, []);

  const setFeedState = useCallback(
    (kind: FeedKind, update: SetStateAction<FeedState>) => {
      setStates((current) => ({
        ...current,
        [kind]: resolveUpdate(current[kind], update),
      }));
    },
    [],
  );

  const rememberScroll = useCallback((kind: FeedKind, scrollY: number) => {
    scrollPositions.current[kind] = scrollY;
    setStates((current) => ({
      ...current,
      [kind]: { ...current[kind], scrollY },
    }));
  }, []);

  const scrollFor = useCallback((kind: FeedKind) => scrollPositions.current[kind], []);

  const saveDiscoveryForLogin = useCallback(() => {
    sessionStorage.setItem(
      resumeStorageKey,
      JSON.stringify({ discovery: states.discovery }),
    );
  }, [states.discovery]);

  const clearRestoredFocus = useCallback(() => setRestoredFocus(undefined), []);

  const saveForBrowse = useCallback(
    (kind: FeedKind, scrollY: number, focusTarget: string) => {
      browseResume = {
        states: {
          ...states,
          [kind]: { ...states[kind], scrollY },
        },
        scrollPositions: {
          ...scrollPositions.current,
          [kind]: scrollY,
        },
        focusTarget,
      };
    },
    [states],
  );

  const value = useMemo(
    () => ({
      restored,
      states,
      setFeedState,
      rememberScroll,
      scrollFor,
      saveDiscoveryForLogin,
      saveForBrowse,
      restoredFocus,
      clearRestoredFocus,
    }),
    [
      rememberScroll,
      restored,
      restoredFocus,
      clearRestoredFocus,
      saveForBrowse,
      saveDiscoveryForLogin,
      scrollFor,
      setFeedState,
      states,
    ],
  );

  return (
    <FeedWorkspaceContext.Provider value={value}>
      {children}
    </FeedWorkspaceContext.Provider>
  );
}

export function useFeedWorkspace() {
  const workspace = useContext(FeedWorkspaceContext);
  if (!workspace) throw new Error("FeedWorkspace is required");
  return workspace;
}

function freshWorkspace(): WorkspaceState {
  return {
    discovery: { ...emptyFeedState },
    following: { ...emptyFeedState },
  };
}

function resolveUpdate<T>(current: T, update: SetStateAction<T>): T {
  return typeof update === "function"
    ? (update as (previous: T) => T)(current)
    : update;
}
