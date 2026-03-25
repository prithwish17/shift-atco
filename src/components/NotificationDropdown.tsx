import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, ArrowLeftRight, Calendar, Clock, Award, Stethoscope, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllRead,
  type Notification,
} from "@/hooks/useNotifications";
import { formatDistanceToNow } from "date-fns";

function categoryIcon(category: string | null) {
  switch (category) {
    case "ope_reminder":
      return <Calendar className="size-4 text-blue-500 shrink-0" />;
    case "leave_status":
      return <Clock className="size-4 text-green-500 shrink-0" />;
    case "duty_exchange":
      return <ArrowLeftRight className="size-4 text-purple-500 shrink-0" />;
    case "compoff_expiry":
    case "compoff_expired":
      return <AlertTriangle className="size-4 text-amber-500 shrink-0" />;
    case "license_expiry":
    case "license_expired":
      return <Award className="size-4 text-red-500 shrink-0" />;
    default:
      return <Bell className="size-4 text-gray-500 shrink-0" />;
  }
}

function NotificationItem({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: (n: Notification) => void;
}) {
  const timeAgo = formatDistanceToNow(new Date(notification.created_at), { addSuffix: true });
  return (
    <button
      className={`w-full text-left px-3 py-2.5 flex gap-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-800 last:border-0 ${
        !notification.read ? "bg-blue-50/50 dark:bg-blue-950/20" : ""
      }`}
      onClick={() => onRead(notification)}
    >
      <div className="mt-0.5">{categoryIcon(notification.category)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <p className={`text-sm leading-tight ${!notification.read ? "font-semibold text-gray-900 dark:text-gray-100" : "font-medium text-gray-700 dark:text-gray-300"}`}>
            {notification.title}
          </p>
          {!notification.read && (
            <span className="mt-1 size-2 rounded-full bg-blue-500 shrink-0" />
          )}
        </div>
        {notification.body && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
            {notification.body}
          </p>
        )}
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{timeAgo}</p>
      </div>
    </button>
  );
}

export function NotificationDropdown() {
  const navigate = useNavigate();
  const { data: notifications = [] } = useNotifications();
  const { data: unreadCount = 0 } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllRead = useMarkAllRead();

  const handleRead = (n: Notification) => {
    if (!n.read) markAsRead.mutate(n.id);
    const url = n.metadata?.url;
    if (url && typeof url === "string") navigate(url);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
          <Bell className="size-5 text-gray-600 dark:text-gray-300" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="size-3.5 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[360px]">
          {notifications.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No notifications yet
            </div>
          ) : (
            notifications.map((n) => (
              <NotificationItem key={n.id} notification={n} onRead={handleRead} />
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
