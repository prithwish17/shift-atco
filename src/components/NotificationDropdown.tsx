import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  ArrowLeftRight,
  Calendar,
  Clock,
  Award,
  Stethoscope,
  AlertTriangle,
  BellOff,
  Inbox,
  Trash2,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllRead,
  useClearNotification,
  useClearAllNotifications,
  type Notification,
} from "@/hooks/useNotifications";
import { formatDistanceToNow } from "date-fns";

/* ─── Category → Icon + Color mapping ─── */
const CATEGORY_STYLES: Record<string, { Icon: typeof Bell; accent: string; bg: string }> = {
  ba_test_selected: {
    Icon: Stethoscope,
    accent: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-100 dark:bg-cyan-900/40",
  },
  ope_reminder: {
    Icon: Calendar,
    accent: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-100 dark:bg-blue-900/40",
  },
  leave_status: {
    Icon: Clock,
    accent: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
  },
  duty_exchange: {
    Icon: ArrowLeftRight,
    accent: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-100 dark:bg-purple-900/40",
  },
  compoff_expiry: {
    Icon: AlertTriangle,
    accent: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-900/40",
  },
  compoff_expired: {
    Icon: AlertTriangle,
    accent: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-900/40",
  },
  license_expiry: {
    Icon: Award,
    accent: "text-red-600 dark:text-red-400",
    bg: "bg-red-100 dark:bg-red-900/40",
  },
  license_expired: {
    Icon: Award,
    accent: "text-red-600 dark:text-red-400",
    bg: "bg-red-100 dark:bg-red-900/40",
  },
};

const DEFAULT_STYLE = {
  Icon: Bell,
  accent: "text-slate-600 dark:text-slate-400",
  bg: "bg-slate-100 dark:bg-slate-800",
};

function getCategoryStyle(category: string | null) {
  return (category && CATEGORY_STYLES[category]) || DEFAULT_STYLE;
}

/* ─── Single notification row ─── */
function NotificationItem({
  notification,
  onRead,
  onClear,
}: {
  notification: Notification;
  onRead: (n: Notification) => void;
  onClear: (id: string) => void;
}) {
  const timeAgo = formatDistanceToNow(new Date(notification.created_at), { addSuffix: true });
  const { Icon, accent, bg } = getCategoryStyle(notification.category);
  const isUnread = !notification.read;

  return (
    <div
      className={`group relative w-full text-left px-3 py-3 flex gap-3 transition-colors rounded-lg mx-1 ${
        isUnread
          ? "bg-blue-50/70 hover:bg-blue-100/70 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
          : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
      }`}
      style={{ width: "calc(100% - 8px)" }}
    >
      {/* Clickable area for reading / navigation */}
      <button
        className="flex gap-3 flex-1 min-w-0 text-left"
        onClick={() => onRead(notification)}
      >
        {/* Icon with colored background circle */}
        <div className={`shrink-0 mt-0.5 size-8 rounded-full flex items-center justify-center ${bg}`}>
          <Icon className={`size-4 ${accent}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p
              className={`text-[13px] leading-snug ${
                isUnread
                  ? "font-semibold text-slate-900 dark:text-slate-50"
                  : "font-medium text-slate-700 dark:text-slate-300"
              }`}
            >
              {notification.title}
            </p>
            {isUnread && (
              <span className="mt-1.5 size-2 rounded-full bg-blue-500 shrink-0 ring-2 ring-blue-500/20" />
            )}
          </div>
          {notification.body && (
            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5 leading-relaxed">
              {notification.body}
            </p>
          )}
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 font-medium tracking-wide uppercase">
            {timeAgo}
          </p>
        </div>
      </button>

      {/* Clear (delete) button — visible on hover / always on touch */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClear(notification.id);
        }}
        className="shrink-0 self-center size-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/30 sm:opacity-0 active:opacity-100"
        aria-label="Clear notification"
        title="Clear notification"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/* ─── Section label ─── */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
        {children}
      </span>
    </div>
  );
}

/* ─── Empty state ─── */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6">
      <div className="size-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
        <Inbox className="size-7 text-slate-400 dark:text-slate-500" />
      </div>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">All caught up!</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 text-center leading-relaxed">
        You have no notifications right now.<br />
        We'll let you know when something arrives.
      </p>
    </div>
  );
}

/* ─── Main dropdown component ─── */
export function NotificationDropdown() {
  const navigate = useNavigate();
  const { data: notifications = [] } = useNotifications();
  const { data: unreadCount = 0 } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllRead = useMarkAllRead();
  const clearNotification = useClearNotification();
  const clearAllNotifications = useClearAllNotifications();

  const handleRead = (n: Notification) => {
    if (!n.read) markAsRead.mutate(n.id);
    const url = n.metadata?.url;
    if (url && typeof url === "string") navigate(url);
  };

  const handleClear = (id: string) => {
    clearNotification.mutate(id);
  };

  const handleClearAll = () => {
    clearAllNotifications.mutate();
  };

  // Split into unread (new) and read (earlier) groups
  const { unread, earlier } = useMemo(() => {
    const unread: Notification[] = [];
    const earlier: Notification[] = [];
    for (const n of notifications) {
      if (!n.read) unread.push(n);
      else earlier.push(n);
    }
    return { unread, earlier };
  }, [notifications]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative p-2 rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Notifications"
        >
          {unreadCount > 0 ? (
            <BellOff className="size-5 text-slate-600 dark:text-slate-300" />
          ) : (
            <Bell className="size-5 text-slate-600 dark:text-slate-300" />
          )}
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full ring-2 ring-white dark:ring-gray-900 shadow-sm">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[calc(100vw-32px)] sm:w-96 p-0 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl dark:shadow-slate-950/50 overflow-hidden"
      >
        {/* ─── Header ─── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 tracking-tight">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold text-blue-700 bg-blue-100 dark:text-blue-200 dark:bg-blue-900/50 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-950/30"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                <CheckCheck className="size-3.5 mr-1" />
                Read all
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] font-semibold text-red-500 hover:text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30"
                onClick={handleClearAll}
                disabled={clearAllNotifications.isPending}
              >
                <Trash2 className="size-3.5 mr-1" />
                Clear all
              </Button>
            )}
          </div>
        </div>

        {/* ─── Notification list with native scroll ─── */}
        <div className="max-h-[420px] overflow-y-auto overscroll-contain bg-white dark:bg-slate-900">
          {notifications.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="py-1">
              {/* New / Unread section */}
              {unread.length > 0 && (
                <>
                  <SectionLabel>New</SectionLabel>
                  {unread.map((n) => (
                    <NotificationItem key={n.id} notification={n} onRead={handleRead} onClear={handleClear} />
                  ))}
                </>
              )}

              {/* Earlier / Read section */}
              {earlier.length > 0 && (
                <>
                  <SectionLabel>Earlier</SectionLabel>
                  {earlier.map((n) => (
                    <NotificationItem key={n.id} notification={n} onRead={handleRead} onClear={handleClear} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
