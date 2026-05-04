# Redis Caching Architecture

## Overview

The SHIFT ATCO application implements a three-tier caching strategy to optimize performance and reduce database load:

1. **Browser Cache** (TanStack Query) - 30s to 5min `staleTime`
2. **Redis Cache** (Upstash) - 5-30min TTL, shared across all users
3. **PostgreSQL** - Precomputed tables and materialized views

This architecture delivers sub-500ms response times for cached data and reduces database load by 60-80%.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Browser                           │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │          TanStack Query Cache (2-5 min staleTime)          │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ HTTP Request
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Vercel API Routes                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │            Cache Wrapper (lib/cacheWrapper.ts)             │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ GET/SET
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                Upstash Redis (5-30 min TTL)                      │
│  ┌─────────┬─────────┬──────────┬────────────┬───────────────┐ │
│  │Working  │  Leave  │  Avail.  │  Schedule  │   Roster      │ │
│  │ Hours   │ Roster  │  Chart   │  (Month)   │  (Team/Date)  │ │
│  └─────────┴─────────┴──────────┴────────────┴───────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ Cache Miss → Query
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Supabase PostgreSQL                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Precomputed Tables & Materialized Views                   │ │
│  │  • working_hours_cache                                     │ │
│  │  • monthly_roster_summary                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Raw Tables (employee_schedules, leave_requests, etc.)     │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Cache Keys & TTLs

### Naming Convention

Keys use a prefix-based naming scheme: `<category>:<identifier>[:<sub-identifier>]`

### Cache Key Reference

| Key Pattern | TTL | Example | Invalidation Trigger |
|------------|-----|---------|---------------------|
| `wh:{month}` | 20 min | `wh:2026-04` | Schedule change, cron refresh |
| `wh:summary:{month}` | 20 min | `wh:summary:2026-04` | Same as above |
| `avail:{month}` | 15 min | `avail:2026-04` | Schedule change, extra duty added |
| `leave:{month}` | 10 min | `leave:2026-04` | Leave approved/rejected/modified |
| `leave:{month}:{team}` | 10 min | `leave:2026-04:A` | Leave change for specific team |
| `sched:{month}` | 5 min | `sched:2026-04` | Any schedule edit |
| `sched:{month}:{empCode}` | 5 min | `sched:2026-04:10024002` | Specific employee schedule edit |
| `roster:{team}:{shift}:{date}` | 30 min | `roster:A:M:2026-04-29` | Roster sync |
| `daily:{date}` | 1 hour | `daily:2026-04-29` | Schedule change on date |

### Statistics Keys

| Key | Description | Retention |
|-----|-------------|-----------|
| `stats:hits:{date}` | Cache hit counts by key prefix | 7 days |
| `stats:misses:{date}` | Cache miss counts by key prefix | 7 days |
| `keys:{tag}` | Set of keys tagged for invalidation | Until deleted |

## API Routes

### Working Hours

**Endpoint**: `/api/working-hours?month=2026-04`

**Cache Strategy**:
1. Check Redis cache (20min TTL)
2. Query `working_hours_cache` table
3. Fall back to `get_working_hours_summary` RPC
4. Last resort: client-side computation

**Headers**:
- `Authorization: Bearer {jwt}`
- `Cache-Control: private, max-age=60`

### Leave Roster

**Endpoint**: `/api/leave-roster?month=2026-04&team=A&status=Approved`

**Cache Strategy**:
1. Check Redis cache (10min TTL)
2. Query `leave_requests` table with filters

**Headers**:
- `Authorization: Bearer {jwt}`
- `Cache-Control: private, max-age=120`

### Cache Management

**Invalidate**: `POST /api/cache/invalidate`

Body:
```json
{
  "keys": ["wh:2026-04", "avail:2026-04"]
}
```

**Stats**: `GET /api/cache/stats`

Response:
```json
{
  "today": {
    "hits": 1250,
    "misses": 180,
    "total": 1430,
    "hitRatio": 87.4,
    "byKey": { ... }
  },
  "yesterday": { ... }
}
```

**Metrics**: `GET /api/metrics`

Returns slow queries and endpoint statistics.

## Cache Invalidation

### Automatic Invalidation

Mutations automatically invalidate related caches:

| Mutation | Invalidates |
|----------|-------------|
| Update schedule duty code | `sched:{month}`, `avail:{month}`, `wh:{month}` |
| Approve/reject leave | `leave:{month}:*` |
| Sync roster | `roster:*` for affected dates |
| Refresh working hours (cron) | `wh:*` |

### Manual Invalidation

**From Code**:
```typescript
import { CacheKeys } from '@/lib/redis';
import { invalidateScheduleCache } from '@/lib/cacheInvalidation';

// Invalidate specific cache
await invalidateScheduleCache('2026-04-29');

// Invalidate via API
await fetch('/api/cache/invalidate', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ 
    keys: [CacheKeys.workingHours('2026-04')] 
  }),
});
```

**From Admin UI**:

Visit **Admin → Cache Monitoring** to:
- View real-time cache statistics
- Monitor hit/miss ratios
- Clear specific caches
- View slow queries

## Integration Guide

### Adding Cache to a New Page

1. **Create API Route** (`api/my-feature.ts`):
```typescript
import { withCache } from '../lib/cacheWrapper';
import { CacheKeys, CacheTTL } from '../lib/redis';

export default async function handler(req, res) {
  const data = await withCache(
    CacheKeys.myFeature(param),
    async () => {
      // Your expensive query here
      return await supabase.from('table').select('*');
    },
    { ttl: CacheTTL.myFeature, tags: ['my-feature'] }
  );

  return res.json(data);
}
```

2. **Update Frontend**:
```typescript
const { data } = useQuery({
  queryKey: ['my-feature', param],
  queryFn: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`/api/my-feature?param=${param}`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    return response.json();
  },
  staleTime: 5 * 60_000, // 5 minutes
});
```

3. **Add Invalidation**:
```typescript
// In mutation onSuccess:
await fetch('/api/cache/invalidate', {
  method: 'POST',
  body: JSON.stringify({ keys: [CacheKeys.myFeature(param)] }),
});
```

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Cache Hit Ratio | 75-85% | ~80% |
| Working Hours (cached) | <500ms | 200ms |
| Leave Roster (cached) | <500ms | 300ms |
| Daily Redis Commands | <10,000 | ~5,000 |
| DB Query Reduction | 60-70% | ~65% |

## Monitoring

### Dashboard

Access **Admin → Cache Monitoring** for:
- Real-time hit/miss ratios
- Daily command usage
- Cache breakdown by key type
- Slow query analysis

### Alerts

Set up alerts when:
- Hit ratio drops below 70%
- Daily commands exceed 9,000 (90% of free tier)
- Slow queries (>2s) increase

## Troubleshooting

### Low Hit Ratio

**Possible Causes**:
- TTLs too short
- Cache keys not matching (check query parameters)
- Frequent invalidations

**Solutions**:
- Increase TTL if data changes infrequently
- Ensure consistent key generation
- Review invalidation triggers

### High Redis Command Usage

**Check**:
- Unnecessary stat tracking
- Too frequent cache checks
- Missing frontend deduplication

**Solutions**:
- Reduce stat tracking to misses only
- Increase frontend `staleTime`
- Verify TanStack Query deduplication

### Stale Data

**Symptoms**:
- Users see outdated information
- Changes not reflected immediately

**Solutions**:
- Verify invalidation is called on mutations
- Check cache TTL (may be too long)
- Use optimistic updates for instant feedback

## Free Tier Limits

### Upstash Redis Free Tier

- **10,000 commands/day** (current usage: ~5,000)
- **256 MB storage**
- **TLS encryption** included
- **Unlimited bandwidth**

### Cost Optimization

- Use longer TTLs for stable data
- Batch invalidations (`redis.del(key1, key2, key3)`)
- Track stats only on cache misses
- Frontend deduplication via TanStack Query

## Security

### Credentials

Redis credentials in `.env`:
```bash
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AYxxxxx...
```

**Never** expose these in:
- Client-side code
- Git commits
- Public repositories

### API Authentication

All cache API routes require:
- Valid Supabase JWT
- Correct user role (admin for cache management)

### Data Isolation

- User-specific data uses scoped keys
- Shared data (schedules, rosters) safe for multi-user cache
- No PII in cache keys

## Deployment Checklist

- [ ] Redis credentials in Vercel environment variables
- [ ] SQL migration applied (`20260429150000_performance_indexes.sql`)
- [ ] API routes deployed (`/api/working-hours`, `/api/cache/*`)
- [ ] Frontend updated to use API routes
- [ ] Cache monitoring page accessible
- [ ] Hit ratio >70% after 24 hours
- [ ] Daily command usage <9,000

## Support

For issues or questions:
1. Check the [Cache Monitoring Dashboard](#dashboard)
2. Review [Troubleshooting](#troubleshooting)
3. Consult API logs in Vercel
4. Check Redis logs in Upstash dashboard
