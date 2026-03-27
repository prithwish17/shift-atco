import { DashboardLayout } from '@/components/DashboardLayout';
import { ATCDutyGridCore } from '@/components/ATCDutyGridCore';

export default function SupervisorATCView() {
  return (
    <DashboardLayout role="supervisor">
      <ATCDutyGridCore
        role="supervisor"
        title="Supervisor – Shift Duty Grid"
        subtitle="Manage and assign employees to positions"
        showSearch
        canEdit
        canManageExtraDuties
      />
    </DashboardLayout>
  );
}
