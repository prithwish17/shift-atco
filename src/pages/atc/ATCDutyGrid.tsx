import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/DashboardLayout';
import { ATCDutyGridCore } from '@/components/ATCDutyGridCore';

export default function ATCDutyGrid() {
  const { userRole } = useAuth();
  const role = (userRole || 'employee') as 'admin' | 'supervisor' | 'wso' | 'employee';
  const canEdit = role === 'admin' || role === 'supervisor' || role === 'wso';
  const canManageExtraDuties = role === 'admin' || role === 'supervisor';

  return (
    <DashboardLayout role={role}>
      <ATCDutyGridCore
        role={role}
        title="Shift Duty Grid"
        subtitle="Manage position assignments for each shift"
        canEdit={canEdit}
        canManageExtraDuties={canManageExtraDuties}
      />
    </DashboardLayout>
  );
}
