/**
 * Night Channel Allocation — the page's state.
 *
 * The server owns the saved night; this hook owns the working copy the board
 * is edited against. The two are kept apart on purpose: a background refetch
 * must never wipe out unsaved edits, and a save must not be built from anything
 * other than what the person is looking at.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { validateAllocation, type NightAllocationState, type ValidationResult } from "@/domain/night-allocation";
import {
  NightAllocationConflict,
  fetchNightAllocation,
  generateNightAllocation,
  resetNightAllocation,
  saveNightAllocation,
  type NightAllocationResponse,
} from "@/data-access/night-allocation.api";

export const nightAllocationKey = (nightDate: string) => ["night-allocation", nightDate] as const;

export interface NightAllocationStatus {
  text: string;
  tone: "neutral" | "saved" | "blocked";
}

export function useNightAllocation(nightDate: string) {
  const queryClient = useQueryClient();
  const [working, setWorking] = useState<NightAllocationState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<NightAllocationStatus>({ text: "", tone: "neutral" });
  const [conflict, setConflict] = useState<NightAllocationResponse | null>(null);
  const adoptedRef = useRef<string>("");
  // The night on screen right now. A save or reset can finish after the person
  // has moved to another night; its answer must not land on that one.
  const currentNightRef = useRef(nightDate);
  currentNightRef.current = nightDate;

  const query = useQuery({
    queryKey: nightAllocationKey(nightDate),
    queryFn: () => fetchNightAllocation(nightDate),
    enabled: !!nightDate,
    // Deliberately quiet. An earlier version refetched on every window focus
    // with no stale time, which re-rendered the whole board each time the user
    // came back to the tab and read as the page refreshing itself. Two people
    // on the same night are protected by the version check on save — a 409
    // with "load their version" — not by polling.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  /** Adopt the server's version, unless it would discard unsaved work. */
  useEffect(() => {
    const incoming = query.data?.state;
    if (!incoming) return;

    const marker = `${incoming.nightDate}:${incoming.version}`;
    const switchingNight = working?.nightDate !== incoming.nightDate;
    if (!switchingNight && adoptedRef.current === marker) return;
    if (!switchingNight && dirty) {
      // Someone else has saved while this board has unsaved changes. Say so
      // rather than choosing for them.
      if (adoptedRef.current !== marker && adoptedRef.current !== "") {
        setConflict(query.data ?? null);
      }
      return;
    }

    adoptedRef.current = marker;
    setWorking(incoming);
    setDirty(false);
    setConflict(null);
    setStatus(
      incoming.savedAt
        ? { text: savedLabel(incoming), tone: "saved" }
        : { text: "Nothing saved for this night yet.", tone: "neutral" },
    );
  }, [query.data, dirty, working?.nightDate]);

  /** Every board edit goes through here, so nothing can change silently. */
  const update = useCallback(
    (mutate: (state: NightAllocationState) => NightAllocationState, note?: string) => {
      setWorking(current => (current ? mutate(current) : current));
      setDirty(true);
      setStatus({
        text: note ?? "Unsaved changes. Everyone on tonight's page sees them after you save.",
        tone: "neutral",
      });
    },
    [],
  );

  const validation: ValidationResult = useMemo(
    () => (working ? validateAllocation(working) : { errors: [], warnings: [] }),
    [working],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!working) throw new Error("Nothing to save yet.");
      return saveNightAllocation(working);
    },
    onMutate: () => ({ nightDate: working?.nightDate ?? nightDate }),
    onSuccess: response => {
      // Cached under the night that was saved, which is not necessarily the one
      // on screen by the time the answer arrives.
      queryClient.setQueryData(nightAllocationKey(response.state.nightDate), response);
      if (response.state.nightDate !== currentNightRef.current) return;

      adoptedRef.current = `${response.state.nightDate}:${response.state.version}`;
      setWorking(response.state);
      setDirty(false);
      setConflict(null);
      setStatus({ text: savedLabel(response.state), tone: "saved" });
    },
    onError: (error, _variables, context) => {
      if (context && context.nightDate !== currentNightRef.current) return;
      if (error instanceof NightAllocationConflict) {
        setConflict(error.current);
        setStatus({ text: error.message, tone: "blocked" });
        return;
      }
      setStatus({ text: (error as Error).message, tone: "blocked" });
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (!working) throw new Error("Nothing to generate for yet.");
      return generateNightAllocation(working);
    },
  });

  /**
   * Reset. On a night that has been saved, the server saves the fresh night in
   * its place, so it is adopted exactly as a save is. On one that hasn't, it is
   * a working copy like any other edit. Never retried: a reset is not
   * something to repeat behind anyone's back.
   */
  const reset = useMutation({
    mutationFn: () => resetNightAllocation(nightDate, working?.version ?? 0),
    onMutate: () => ({ nightDate }),
    retry: false,
    onSuccess: response => {
      queryClient.setQueryData(nightAllocationKey(response.state.nightDate), current =>
        response.persisted ? response : current,
      );
      if (response.state.nightDate !== currentNightRef.current) return;
      setWorking(response.state);
      setConflict(null);
      if (response.persisted) {
        adoptedRef.current = `${response.state.nightDate}:${response.state.version}`;
        setDirty(false);
        setStatus({ text: "Night reset and saved. Everyone sees the fresh night now.", tone: "saved" });
        return;
      }
      setDirty(true);
      setStatus(
        response.unsavedReason
          ? { text: `Reset here, but not saved: ${response.unsavedReason} Fix that, then save.`, tone: "blocked" }
          : { text: "Reset to a fresh night from the roster. Save it when you're ready.", tone: "neutral" },
      );
    },
    onError: (error, _variables, context) => {
      if (context && context.nightDate !== currentNightRef.current) return;
      if (error instanceof NightAllocationConflict) {
        setConflict(error.current);
        setStatus({ text: error.message, tone: "blocked" });
        return;
      }
      setStatus({ text: (error as Error).message, tone: "blocked" });
    },
  });

  /** Take the newer server version, discarding the local working copy. */
  const acceptServerVersion = useCallback(() => {
    const incoming = conflict ?? query.data;
    if (!incoming) return;
    adoptedRef.current = `${incoming.state.nightDate}:${incoming.state.version}`;
    setWorking(incoming.state);
    setDirty(false);
    setConflict(null);
    setStatus({ text: savedLabel(incoming.state), tone: "saved" });
  }, [conflict, query.data]);

  return {
    state: working,
    /** Why the crew list is empty, when it was seeded rather than loaded. */
    rosterStatus: query.data?.rosterStatus ?? null,
    /** Teams on the shift roster for this night. */
    teams: query.data?.teams ?? [],
    setStatus,
    status,
    dirty,
    conflict,
    acceptServerVersion,
    validation,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    update,
    save,
    generate,
    reset,
  };
}

function savedLabel(state: NightAllocationState): string {
  if (!state.savedAt) return "Nothing saved for this night yet.";
  const when = new Date(state.savedAt);
  const time = Number.isNaN(when.getTime())
    ? ""
    : ` at ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return `Saved by ${state.savedByName ?? "someone"}${time}.`;
}
