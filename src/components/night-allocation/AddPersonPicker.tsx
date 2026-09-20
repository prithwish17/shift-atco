/**
 * Adding someone to tonight's list.
 *
 * The night is seeded from the tower units on the shift roster, which is the
 * crew that actually works the channels. Anyone else who turns up — a reliever,
 * someone swapped in after the roster was published — is added here: first from
 * the rest of the night shift, and failing that by name.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, Plus, UserPlus } from "lucide-react";
import { fetchShiftCandidates, type ShiftCandidate } from "@/data-access/night-allocation.api";

interface AddPersonPickerProps {
  nightDate: string;
  /** Keys already on the board, so they are not offered twice. */
  existingKeys: string[];
  onAddFromShift: (candidate: ShiftCandidate) => void;
  onAddByName: (name: string) => void;
}

export function AddPersonPicker({ nightDate, existingKeys, onAddFromShift, onAddByName }: AddPersonPickerProps) {
  const [open, setOpen] = useState(false);
  const [showByName, setShowByName] = useState(false);
  const [name, setName] = useState("");

  // Only fetched when the picker is opened — it is a whole shift's worth of
  // people and most nights nobody needs it.
  const { data: candidates = [], isLoading, error } = useQuery({
    queryKey: ["night-allocation-shift", nightDate],
    queryFn: () => fetchShiftCandidates(nightDate),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const available = candidates.filter(candidate => !existingKeys.includes(candidate.key));

  const submitName = () => {
    if (!name.trim()) return;
    onAddByName(name);
    setName("");
    setShowByName(false);
  };

  return (
    <div className="space-y-2 pt-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start">
            <UserPlus className="mr-2 h-4 w-4" />
            Add someone from tonight's shift
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search the night shift…" />
            <CommandList className="max-h-64">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-corp-text-soft">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading tonight's shift…
                </div>
              ) : error ? (
                <div className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">
                  {(error as Error).message}
                </div>
              ) : (
                <>
                  <CommandEmpty className="py-6 text-center text-sm text-corp-text-soft">
                    {candidates.length
                      ? "Everyone on the shift is already on the list."
                      : "Nobody is rostered on nights for this date."}
                  </CommandEmpty>
                  {available.map(candidate => (
                    <CommandItem
                      key={candidate.key}
                      value={`${candidate.name} ${candidate.code}`}
                      className="cursor-pointer"
                      onSelect={() => {
                        onAddFromShift(candidate);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-corp-text-soft">
                        {candidate.code}
                        {candidate.canTakeTso ? " · TSO" : ""}
                      </span>
                    </CommandItem>
                  ))}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {showByName ? (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Escape") setShowByName(false);
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitName();
            }}
            placeholder="Name"
            aria-label="Name of person to add to tonight's shift"
          />
          <Button variant="outline" onClick={submitName}>
            Add
          </Button>
        </div>
      ) : (
        <Button variant="link" className="h-auto p-0 text-sm" onClick={() => setShowByName(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Someone not on the roster
        </Button>
      )}
    </div>
  );
}
