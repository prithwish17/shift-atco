// Data Access Layer - External Leave Data API Adapter

import type { RawLeaveRecord } from '@/domain/leave';
import { supabase } from '@/integrations/supabase/client';

export interface LeaveApiResponse {
  status?: string;
  count?: number;
  data: RawLeaveRecord[];
}

export class ExternalLeaveAPI {
  /**
   * Fetch leave data from external Google Apps Script API
   */
  async fetchFromExternalSource(url: string): Promise<LeaveApiResponse> {
    if (!url || !url.trim()) {
      throw new Error('Leave API URL is not configured');
    }

    const response = await fetch(url, { method: 'GET' });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const detail = payload?.error || payload?.message;
      throw new Error(detail || `Leave API error (${response.status})`);
    }

    const json = await response.json();
    const data = Array.isArray(json?.data) ? (json.data as RawLeaveRecord[]) : [];
    const count = typeof json?.count === 'number' ? json.count : data.length;

    return {
      status: typeof json?.status === 'string' ? json.status : undefined,
      count,
      data,
    };
  }

  /**
   * Trigger Supabase edge function to sync leave data
   */
  async triggerSync(): Promise<any> {
    const { data, error } = await supabase.functions.invoke('fetch-leave-data', { body: {} });
    if (error) throw error;
    return data;
  }

  /**
   * Cache leave data in local database
   */
  async cacheLeaveData(records: RawLeaveRecord[]): Promise<void> {
    if (!records.length) return;

    const payload = records.map((record) => ({
      emp_id: record.empId != null ? String(record.empId).trim() : '',
      name: typeof record.name === 'string' ? record.name.trim() : null,
      status: typeof record.status === 'string' ? record.status : null,
      payload: record,
      updated_at: new Date().toISOString(),
    })).filter((row) => row.emp_id);

    if (payload.length === 0) return;

    const { error } = await supabase
      .from('leave_balances_cache')
      .upsert(payload, { onConflict: 'emp_id' });

    if (error) throw error;
  }

  /**
   * Get cached leave data
   */
  async getCachedLeaveData(empId?: string): Promise<RawLeaveRecord[]> {
    let query = supabase
      .from('leave_balances_cache')
      .select('payload');

    if (empId) {
      query = query.eq('emp_id', empId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((row: any) => row.payload as RawLeaveRecord);
  }
}

export const externalLeaveAPI = new ExternalLeaveAPI();
