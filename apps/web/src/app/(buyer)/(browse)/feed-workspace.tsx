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
  saveForLogin: (kind: FeedKind, scrollY: number) => void;
};

const resumeStorageKey = "sevo:buyer-feeds:login-resume";
const FeedWorkspaceContext = createContext<FeedWorkspaceValue | undefined>(undefined);

export function FeedWorkspace({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<WorkspaceState>(freshWorkspace);
  const [restored, setRestored] = useState(false);
  const scrollPositions = useRef<Record<FeedKind, number>>({
    discovery: 0,
    following: 0,
  });

  useEffect(() => {
    const saved = sessionStorage.getItem(resumeStorageKey);
    sessionStorage.removeItem(resumeStorageKey);
    if (saved) {
      try {
        const snapshot = JSON.parse(saved) as WorkspaceState;
        scrollPositions.current = {
          discovery: snapshot.discovery.scrollY,
          following: snapshot.following.scrollY,
        };
        setStates(snapshot);
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

  const saveForLogin = useCallback(
    (kind: FeedKind, scrollY: number) => {
      sessionStorage.setItem(
        resumeStorageKey,
        JSON.stringify({
          ...states,
          [kind]: { ...states[kind], scrollY },
        }),
      );
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
      saveForLogin,
    }),
    [rememberScroll, restored, saveForLogin, scrollFor, setFeedState, states],
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
