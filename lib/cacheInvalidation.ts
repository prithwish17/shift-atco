import { redis, CacheKeys, invalidatePattern } from './redis';

/**
 * Centralized cache invalidation helpers
 */

export async function invalidateScheduleCache(date: string) {
  const month = date.slice(0, 7); // yyyy-MM
  await Promise.all([
    redis.del(CacheKeys.scheduleMonth(month)),
    redis.del(CacheKeys.dailySnapshot(date)),
    invalidatePattern(`sched:${month}:*`), // All employee schedules for month
  ]);
}

export async function invalidateEmployeeSchedule(employeeCode: string, month: string) {
  await redis.del(CacheKeys.scheduleMonth(month, employeeCode));
  // Also invalidate month-wide cache (affects availability)
  await redis.del(CacheKeys.availability(month));
}

export async function invalidateWorkingHours(month: string) {
  await Promise.all([
    redis.del(CacheKeys.workingHours(month)),
    redis.del(CacheKeys.workingHoursSummary(month)),
    invalidatePattern('wh:*'),
  ]);
}

export async function invalidateLeaveCache(startDate: string, endDate: string) {
  // Invalidate all months covered by the leave period
  const months = new Set<string>();
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
    months.add(d.toISOString().slice(0, 7));
  }

  await Promise.all(
    Array.from(months).map(month => 
      invalidatePattern(`leave:${month}:*`)
    )
  );
}

export async function invalidateAvailability(month: string) {
  await redis.del(CacheKeys.availability(month));
}

// Batch invalidation for schedule changes (used by cron jobs)
export async function invalidateBulkSchedules(dates: string[]) {
  const months = new Set(dates.map(d => d.slice(0, 7)));
  
  await Promise.all(
    Array.from(months).flatMap(month => [
      redis.del(CacheKeys.scheduleMonth(month)),
      redis.del(CacheKeys.availability(month)),
      redis.del(CacheKeys.workingHours(month)),
    ])
  );
}
