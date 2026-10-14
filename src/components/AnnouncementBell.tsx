import React from 'react';
import { Bell } from 'lucide-react';

export function AnnouncementBell({ onClick, hasUnread = false }: { onClick: () => void; hasUnread?: boolean }) {
  return (
    <button type="button" onClick={onClick} data-announcement-trigger aria-label="查看历史公告" aria-haspopup="dialog" title={hasUnread ? '公告中心（有未读公告）' : '公告中心'} className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-1 text-purple-700 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2">
      <span aria-hidden="true" className="relative flex h-9 w-9 items-center justify-center rounded-full border border-purple-200 bg-purple-50 transition-colors duration-150 group-hover:bg-purple-100 dark:border-violet-700 dark:bg-slate-900 dark:text-violet-200 dark:group-hover:bg-slate-800">
        <Bell className="h-[18px] w-[18px]" />
        {hasUnread && <span className="absolute right-1 top-1 h-2 w-2 rounded-full border-2 border-purple-50 bg-fuchsia-600 dark:border-slate-900" />}
      </span>
    </button>
  );
}
