import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { NormalizedLeaveRecord } from "@/utils/leaveCalculations";

interface EmployeeLeaveTableProps {
  employees: NormalizedLeaveRecord[];
  highUsageEmpIds: Set<string>;
  onViewDetails: (record: NormalizedLeaveRecord) => void;
}

export function EmployeeLeaveTable({ employees, highUsageEmpIds, onViewDetails }: EmployeeLeaveTableProps) {
  if (employees.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-10 text-center">
        No employees match your search.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Emp ID</TableHead>
          <TableHead>Status</TableHead>
        <TableHead className="text-right">Casual Used</TableHead>
        <TableHead className="text-right">Casual Remaining</TableHead>
        <TableHead className="text-right">Restricted</TableHead>
        <TableHead className="text-right">Comp-Off Used</TableHead>
          <TableHead className="text-right">Usage</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {employees.map((emp) => {
          const isHighUsage = highUsageEmpIds.has(emp.empId);
          return (
            <TableRow key={emp.empId} className={isHighUsage ? "bg-amber-50" : undefined}>
              <TableCell className="font-medium">{emp.name || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{emp.empId}</TableCell>
              <TableCell>
                <Badge variant={emp.status === "Inactive" ? "secondary" : "default"}>
                  {emp.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">{emp.casualCount}</TableCell>
              <TableCell className="text-right">{emp.casualRemaining}</TableCell>
              <TableCell className="text-right">{emp.restrictedCount}</TableCell>
              <TableCell className="text-right">{emp.compOffUsed}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <span className="font-semibold">{emp.usageScore}</span>
                  {isHighUsage && (
                    <Badge variant="outline" className="border-amber-500 text-amber-700">
                      High
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <Button variant="outline" size="sm" onClick={() => onViewDetails(emp)}>
                  View
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
