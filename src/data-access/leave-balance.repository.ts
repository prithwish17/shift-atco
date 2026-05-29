// Data Access Layer - Repository for Leave Balances

import type { LeaveBalance, BalanceBucket } from '@/domain/leave';
import { supabase } from '@/integrations/supabase/client';

export class LeaveBalanceRepository {
  /**
   * Fetch leave balances for a specific user
   */
  async findByUserId(userId: string): Promise<LeaveBalance[]> {
    const { data, error } = await supabase
      .from('leave_balances')
      .select('*')
      .eq('user_id', userId)
      .order('year', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get balance for a specific bucket and year
   */
  async getBalance(userId: string, bucket: BalanceBucket, year: number): Promise<LeaveBalance | null> {
    const { data, error } = await supabase
      .from('leave_balances')
      .select('*')
      .eq('user_id', userId)
      .eq('leave_type', bucket)
      .eq('year', year)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Deduct leave balance (atomic operation via RPC)
   */
  async deduct(userId: string, bucket: BalanceBucket, year: number, days: number): Promise<void> {
    const { error } = await supabase.rpc('deduct_leave_balance', {
      p_user_id: userId,
      p_leave_type: bucket,
      p_year: year,
      p_days: days,
    });

    if (error) throw error;
  }

  /**
   * Restore leave balance (atomic operation via RPC)
   */
  async restore(userId: string, bucket: BalanceBucket, year: number, days: number): Promise<void> {
    const { error } = await supabase.rpc('restore_leave_balance', {
      p_user_id: userId,
      p_leave_type: bucket,
      p_year: year,
      p_days: days,
    });

    if (error) throw error;
  }

  /**
   * Create or update a balance record
   */
  async upsert(balance: Omit<LeaveBalance, 'id' | 'created_at' | 'updated_at'>): Promise<LeaveBalance> {
    const { data, error } = await supabase
      .from('leave_balances')
      .upsert(balance, { onConflict: 'user_id,leave_type,year' })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

export const leaveBalanceRepository = new LeaveBalanceRepository();
