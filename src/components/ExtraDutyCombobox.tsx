import { useState } from "react";
import { Plus } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface ExtraDutyComboboxProps {
  cellKey: string;
  candidates: string[];
  onAdd: (cellKey: string, name: string) => void;
}

export function ExtraDutyCombobox({ cellKey, candidates, onAdd }: ExtraDutyComboboxProps) {
  const [open, setOpen] = useState(false);

  if (candidates.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Add extra duty assignment"
          className="flex items-center gap-0.5 rounded border border-dashed border-orange-400/70 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 transition hover:border-orange-500 hover:bg-orange-50 dark:border-orange-600/50 dark:text-orange-400 dark:hover:bg-orange-900/20"
          onClick={(e) => e.stopPropagation()}
        >
          <Plus size={9} />
          Add
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start" side="bottom">
        <Command>
          <CommandInput placeholder="Search name…" className="h-8 text-xs" />
          <CommandList className="max-h-48">
            <CommandEmpty className="py-3 text-center text-xs text-slate-400">
              No candidates found
            </CommandEmpty>
            {candidates.map((name) => (
              <CommandItem
                key={name}
                value={name}
                className="cursor-pointer px-3 py-2 text-xs"
                onSelect={() => {
                  onAdd(cellKey, name);
                  setOpen(false);
                }}
              >
                {name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
