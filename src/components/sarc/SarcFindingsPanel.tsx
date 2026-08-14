/**
 * Pre-flight findings.
 *
 * Errors block issuing; warnings and information do not. The sheet's failure
 * mode was that bad data silently became a number, so nothing here refuses to
 * compute — it puts the problem where an operator can see it before they sign
 * a statement.
 */

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { PreflightFinding, PreflightSeverity } from '@/domain/sarc';

const SEVERITY_ORDER: PreflightSeverity[] = ['error', 'warning', 'info'];

const SEVERITY_STYLE: Record<PreflightSeverity, { icon: typeof Info; className: string; label: string }> = {
    error: { icon: XCircle, className: 'text-destructive', label: 'Blocking' },
    warning: { icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-500', label: 'Check' },
    info: { icon: Info, className: 'text-muted-foreground', label: 'For information' },
};

export function SarcFindingsPanel({ findings }: { findings: readonly PreflightFinding[] }) {
    const [expanded, setExpanded] = useState<string | null>(null);

    if (findings.length === 0) {
        return (
            <Card>
                <CardContent className="flex items-center gap-2 py-4 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
                    Data checks passed — nothing to review before issuing.
                </CardContent>
            </Card>
        );
    }

    const sorted = [...findings].sort(
        (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );

    return (
        <Card>
            <CardContent className="divide-y p-0">
                {sorted.map((finding) => {
                    const { icon: Icon, className, label } = SEVERITY_STYLE[finding.severity];
                    const isOpen = expanded === finding.code;
                    const hasIds = finding.empIds.length > 0;

                    return (
                        <div key={finding.code} className="px-4 py-3">
                            <div className="flex items-start gap-3">
                                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', className)} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge
                                            variant={finding.severity === 'error' ? 'destructive' : 'secondary'}
                                            className="text-[10px]"
                                        >
                                            {label}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">{finding.code}</span>
                                    </div>
                                    <p className="mt-1 text-sm">{finding.message}</p>

                                    {hasIds && (
                                        <>
                                            <Button
                                                variant="link"
                                                size="sm"
                                                className="h-auto p-0 text-xs"
                                                onClick={() => setExpanded(isOpen ? null : finding.code)}
                                            >
                                                <ChevronDown
                                                    className={cn(
                                                        'mr-1 h-3 w-3 transition-transform',
                                                        isOpen && 'rotate-180',
                                                    )}
                                                />
                                                {isOpen ? 'Hide' : `Show ${finding.empIds.length}`} employee
                                                {finding.empIds.length > 1 ? 's' : ''}
                                            </Button>
                                            {isOpen && (
                                                <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
                                                    {finding.empIds.join(', ')}
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}
