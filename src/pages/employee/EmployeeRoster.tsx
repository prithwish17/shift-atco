import { DashboardLayout } from "@/components/DashboardLayout";
import ShiftRosterView from "@/components/roster/ShiftRosterView";

export default function EmployeeRoster() {
    return (
        <DashboardLayout role="employee">
            <ShiftRosterView description="Who is on each shift today. Teams are set automatically by the duty rotation." />
        </DashboardLayout>
    );
}
