import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Database, RefreshCw, TrendingUp, TrendingDown, Activity,
  BarChart3, Clock, Zap, AlertCircle,
} from "lucide-react";

interface CacheStats {
  today: {
    date: string;
    hits: number;
    misses: number;
    total: number;
    hitRatio: number;
    byKey: {
      hits: Record<string, string>;
      misses: Record<string, string>;
    };
  };
  yesterday: {
    date: string;
    hits: number;
    misses: number;
    total: number;
    hitRatio: number;
    byKey: {
      hits: Record<string, string>;
      misses: Record<string, string>;
    };
  };
}

export default function CacheMonitoring() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isClearing, setIsClearing] = useState(false);

  // Fetch cache statistics
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<CacheStats>({
    queryKey: ['cache-stats'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch('/api/cache/stats', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch cache stats');
      return response.json();
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Auto-refresh every minute
  });

  // Fetch performance metrics
  const { data: metrics, isLoading: metricsLoading, refetch: refetchMetrics } = useQuery({
    queryKey: ['performance-metrics'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch('/api/metrics', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch metrics');
      return response.json();
    },
    staleTime: 60 * 1000, // 1 minute
  });

  async function handleClearCache(keys: string[]) {
    setIsClearing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch('/api/cache/invalidate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keys }),
      });

      if (!response.ok) throw new Error('Failed to clear cache');

      toast({
        title: 'Cache cleared',
        description: `Invalidated ${keys.length} cache keys`,
      });

      await refetchStats();
    } catch (error: any) {
      toast({
        title: 'Failed to clear cache',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsClearing(false);
    }
  }

  const hitRatioChange = stats ? stats.today.hitRatio - stats.yesterday.hitRatio : 0;
  const isImproving = hitRatioChange > 0;

  return (
    <DashboardLayout role="admin">
      <div className="space-y-5 max-w-[1400px]">
        {/* Header */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="h-6 w-6 text-primary" />
              Redis Cache Monitoring
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Real-time cache performance and statistics
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                refetchStats();
                refetchMetrics();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-2"
              onClick={() => handleClearCache(['wh:*', 'avail:*', 'leave:*', 'sched:*', 'roster:*'])}
              disabled={isClearing}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              Clear All Cache
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <Skeleton className="h-16 w-full" />
                </CardContent>
              </Card>
            ))
          ) : stats ? (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Cache Hit Ratio (Today)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.today.hitRatio.toFixed(1)}%</div>
                  <div className="flex items-center gap-1 mt-1">
                    {isImproving ? (
                      <TrendingUp className="h-3 w-3 text-green-500" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-red-500" />
                    )}
                    <span className={`text-xs ${isImproving ? 'text-green-500' : 'text-red-500'}`}>
                      {hitRatioChange > 0 ? '+' : ''}{hitRatioChange.toFixed(1)}% vs yesterday
                    </span>
                  </div>
                  <Progress value={stats.today.hitRatio} className="mt-2 h-2" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Total Requests
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.today.total.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {stats.today.hits.toLocaleString()} hits, {stats.today.misses.toLocaleString()} misses
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Yesterday's Ratio
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.yesterday.hitRatio.toFixed(1)}%</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {stats.yesterday.total.toLocaleString()} total requests
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Badge variant={stats.today.hitRatio > 75 ? "default" : "secondary"} className="text-sm">
                      {stats.today.hitRatio > 85 ? "Excellent" :
                       stats.today.hitRatio > 75 ? "Good" :
                       stats.today.hitRatio > 60 ? "Fair" : "Needs Improvement"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    Target: 75-85% hit ratio
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>

        {/* Cache by Key Breakdown */}
        {stats && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cache Performance by Key Type</CardTitle>
              <CardDescription>Today's cache hits and misses by prefix</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Hits */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-green-500" />
                    Cache Hits
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(stats.today.byKey.hits).length > 0 ? (
                      Object.entries(stats.today.byKey.hits)
                        .sort(([, a], [, b]) => parseInt(b) - parseInt(a))
                        .map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between p-2 rounded bg-muted/50">
                            <span className="text-sm font-medium">{key}</span>
                            <Badge variant="outline">{value}</Badge>
                          </div>
                        ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No cache hits yet today</p>
                    )}
                  </div>
                </div>

                {/* Misses */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    Cache Misses
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(stats.today.byKey.misses).length > 0 ? (
                      Object.entries(stats.today.byKey.misses)
                        .sort(([, a], [, b]) => parseInt(b) - parseInt(a))
                        .map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between p-2 rounded bg-muted/50">
                            <span className="text-sm font-medium">{key}</span>
                            <Badge variant="outline">{value}</Badge>
                          </div>
                        ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No cache misses yet today</p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Performance Metrics */}
        {metrics && !metricsLoading && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Slow Queries (Last 24 Hours)</CardTitle>
              <CardDescription>Queries taking over 2 seconds</CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.slowQueries?.length > 0 ? (
                <div className="space-y-2">
                  {metrics.slowQueries.slice(0, 10).map((query: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded border">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{query.endpoint}</p>
                        <p className="text-xs text-muted-foreground truncate">{query.message || 'No message'}</p>
                      </div>
                      <Badge variant="destructive" className="ml-2">
                        {query.duration_ms}ms
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No slow queries in the last 24 hours</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
