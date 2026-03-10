import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface SearchBarProps {
  value: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  delayMs?: number;
}

export function SearchBar({ value, onSearch, placeholder, delayMs = 300 }: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const handle = setTimeout(() => onSearch(localValue), delayMs);
    return () => clearTimeout(handle);
  }, [localValue, delayMs, onSearch]);

  return (
    <div className="relative w-full">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder || "Search..."}
        className="pl-8 h-9 text-sm"
      />
    </div>
  );
}
