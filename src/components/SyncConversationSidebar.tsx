import { Archive, MessageSquarePlus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { SyncConversationSummary } from "../services/syncConversation";

interface SyncConversationSidebarProps {
  conversations: SyncConversationSummary[];
  activeId: string | null;
  loading?: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SyncConversationSidebar({
  conversations,
  activeId,
  loading = false,
  onNew,
  onSelect,
  onRename,
  onArchive,
  onRestore,
  onDelete,
}: SyncConversationSidebarProps) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? conversations.filter((item) => item.title.toLowerCase().includes(needle))
      : conversations;
  }, [conversations, search]);

  return (
    <aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-white/7 bg-black/10" aria-label="Sync conversations">
      <div className="space-y-2 border-b border-white/7 p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
          New conversation
        </button>
        <label className="relative block">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="w-full rounded-lg border border-white/8 bg-slate-950/60 py-2 pl-8 pr-2 text-xs text-slate-200 placeholder-slate-600 focus:border-teal-400 focus:outline-hidden"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? <div className="px-2 py-3 text-xs text-slate-500">Loading conversations…</div> : null}
        {!loading && visible.length === 0 ? (
          <div className="px-2 py-3 text-xs leading-5 text-slate-500">No matching conversations.</div>
        ) : null}
        <div className="space-y-1">
          {visible.map((conversation) => {
            const archived = conversation.status !== "active";
            return (
              <div
                key={conversation.id}
                className={`group rounded-lg border px-2.5 py-2 ${
                  activeId === conversation.id
                    ? "border-teal-400/25 bg-teal-400/7"
                    : "border-transparent hover:bg-white/3"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className="block w-full text-left"
                >
                  <div className="truncate text-xs font-medium text-slate-300">{conversation.title}</div>
                  <div className="mt-1 text-[10px] capitalize text-slate-600">{archived ? "archived" : conversation.mode}</div>
                </button>
                <div className="mt-1.5 flex items-center gap-1 opacity-70 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      const title = window.prompt("Rename conversation", conversation.title);
                      if (title?.trim() && title.trim() !== conversation.title) onRename(conversation.id, title.trim());
                    }}
                    className="rounded px-1.5 py-1 text-[10px] text-slate-500 hover:bg-white/5 hover:text-slate-300"
                  >
                    Rename
                  </button>
                  {archived ? (
                    <button type="button" onClick={() => onRestore(conversation.id)} className="rounded p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300" aria-label="Restore conversation">
                      <RotateCcw className="h-3 w-3" aria-hidden />
                    </button>
                  ) : (
                    <button type="button" onClick={() => onArchive(conversation.id)} className="rounded p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300" aria-label="Archive conversation">
                      <Archive className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                  <button type="button" onClick={() => onDelete(conversation.id)} className="rounded p-1 text-slate-600 hover:bg-red-500/8 hover:text-red-300" aria-label="Delete conversation">
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
