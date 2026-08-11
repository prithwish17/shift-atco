import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { flattenNav, navByRole, type Role } from "@/lib/navConfig";

interface NavCommandPaletteProps {
  role: Role;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const UNGROUPED_LABEL = "General";

/**
 * Every search term must appear somewhere in the entry, and a match on the
 * first word ranks above one buried mid-string. cmdk's default scorer is a
 * fuzzy subsequence match, which for a fixed list of page names turns typos
 * into confident wrong answers — "medic" ranking Employee Management first.
 */
function scoreEntry(value: string, search: string) {
  const haystack = value.toLowerCase();
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;
  if (!terms.every(term => haystack.includes(term))) return 0;
  return haystack.startsWith(terms[0]) ? 1 : 0.6;
}

/**
 * ⌘K / Ctrl+K navigation search. Indexes sub-pages too, which is the only way
 * to reach some of them without already knowing which page links to them.
 */
export function NavCommandPalette({ role, open, onOpenChange }: NavCommandPaletteProps) {
  const navigate = useNavigate();

  const grouped = useMemo(() => {
    const entries = flattenNav(navByRole[role] ?? []);
    const byGroup = new Map<string, typeof entries>();
    for (const entry of entries) {
      const key = entry.group ?? UNGROUPED_LABEL;
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(entry);
      else byGroup.set(key, [entry]);
    }
    return Array.from(byGroup.entries());
  }, [role]);

  const go = (url: string) => {
    onOpenChange(false);
    navigate(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-lg">
        <DialogTitle className="sr-only">Search pages</DialogTitle>
        <Command filter={scoreEntry} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:text-xs">
          <CommandInput placeholder="Search pages…" />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>No matching page.</CommandEmpty>
            {grouped.map(([label, entries]) => (
              <CommandGroup key={label} heading={label}>
                {entries.map(entry => (
                  <CommandItem
                    key={entry.url}
                    // cmdk scores against `value`, so fold in the context terms.
                    value={[entry.title, entry.parent, label, ...(entry.keywords ?? [])]
                      .filter(Boolean)
                      .join(" ")}
                    onSelect={() => go(entry.url)}
                    className="gap-2 data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-950 dark:data-[selected=true]:bg-blue-950 dark:data-[selected=true]:text-blue-50"
                  >
                    <entry.icon className="size-4 shrink-0 opacity-70" />
                    <span>{entry.title}</span>
                    {entry.parent && (
                      <span className="text-xs text-muted-foreground">in {entry.parent}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
