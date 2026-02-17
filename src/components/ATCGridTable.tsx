import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ATCGridTeam } from "@/hooks/useATCAssignments";

interface ATCGridTableProps {
  teamData: ATCGridTeam;
  positions: string[];
}

function getRoleBadgeVariant(role: string): "default" | "secondary" | "outline" {
  const r = role.toUpperCase();
  if (r === "ATCO") return "default";
  if (r === "WSO") return "secondary";
  if (r === "SUP") return "outline";
  return "default";
}

export function ATCGridTable({ teamData, positions }: ATCGridTableProps) {
  const units = Object.keys(teamData.units).sort();

  if (units.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-center py-8">
        No assignments found for this team.
      </p>
    );
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-bold min-w-[120px]">Unit</TableHead>
            {positions.map((pos) => (
              <TableHead key={pos} className="text-center min-w-[140px]">
                {pos}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {units.map((unit) => (
            <TableRow key={unit}>
              <TableCell className="font-mono font-semibold">{unit}</TableCell>
              {positions.map((pos) => {
                const cells = teamData.units[unit]?.[pos] || [];
                return (
                  <TableCell key={pos} className="text-center">
                    {cells.length > 0 ? (
                      <div className="space-y-1">
                        {cells.map((cell, i) => (
                          <div key={i} className="flex items-center justify-center gap-1.5">
                            <span className="text-sm">{cell.employee_name}</span>
                            {cell.role && (
                              <Badge
                                variant={getRoleBadgeVariant(cell.role)}
                                className="text-[10px] px-1.5 py-0"
                              >
                                {cell.role.toUpperCase()}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
