import { useRef, useCallback, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { MessageSquare, X, Search, Smile, Minimize2, Maximize2, Pencil, Trash2, Paperclip, Loader2 } from "lucide-react";
import type { AppSettings } from "@/lib/settings";
import { MentionInput } from "@/components/mention-input";
import { MessageContent } from "@/lib/markdown";
import { avatarSrc, displayNameOf } from "@/lib/avatar";

const QUICK_REACTIONS = ["👍", "😂", "❤️", "🔥", "👀", "😮", "🎉", "💀"];

const CHAT_COLORS = [
  "text-violet-400", "text-blue-400", "text-emerald-400", "text-orange-400",
  "text-pink-400", "text-amber-400", "text-cyan-400", "text-rose-400",
];
function chatColor(userId: number) { return CHAT_COLORS[userId % CHAT_COLORS.length]; }

const AVATAR_BG = [
  "bg-violet-600", "bg-blue-500", "bg-emerald-600", "bg-orange-500",
  "bg-pink-600", "bg-amber-500", "bg-cyan-600", "bg-rose-600",
];
function avatarBg(userId: number) { return AVATAR_BG[userId % AVATAR_BG.length]; }

export interface ChatPopoutProps {
  messages: any[];
  me: { id: number; username: string };
  members?: { id: number; username: string }[];
  readersByMessage?: Record<number, { id: number; username: string }[]>;
  onFilesDropped?: (files: File[]) => void;
  settings: AppSettings;
  isConnected: boolean;
  typingNames: string[];
  msgInput: string;
  onMsgInputChange: (v: string) => void;
  onSend: (e?: React.FormEvent) => void;
  onFiles?: (files: File[]) => void;
  isUploading?: boolean;
  editingMsgId: number | null;
  editContent: string;
  onEditStart: (id: number, content: string) => void;
  onEditSave: (e: React.FormEvent) => void;
  onEditCancel: () => void;
  onEditContentChange: (v: string) => void;
  onDelete: (id: number) => void;
  onReaction: (messageId: number, emoji: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  defaultPos: { x: number; y: number };
  onPosChange: (pos: { x: number; y: number }) => void;
  defaultSize: { w: number; h: number };
  onSizeChange: (size: { w: number; h: number }) => void;
  onClose: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export function ChatPopout({
  messages, me, members, readersByMessage, onFilesDropped, settings, isConnected,
  typingNames, msgInput, onMsgInputChange, onSend, onFiles, isUploading,
  editingMsgId, editContent, onEditStart, onEditSave, onEditCancel, onEditContentChange,
  onDelete, onReaction,
  hasMore, loadingMore, onLoadMore,
  defaultPos, onPosChange, defaultSize, onSizeChange, onClose,
  messagesEndRef,
}: ChatPopoutProps) {
  const [pos, setPos] = useState(defaultPos);
  const [size, setSize] = useState(defaultSize);
  const sizeRef = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && onFiles) onFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  const onDragOver = (e: React.DragEvent) => {
    if (onFilesDropped && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setIsDragging(true); }
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (onFilesDropped && e.dataTransfer.files?.length) onFilesDropped(Array.from(e.dataTransfer.files));
  };

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const next = {
      x: Math.max(0, Math.min(window.innerWidth - size.w - 4, dragRef.current.px + e.clientX - dragRef.current.sx)),
      y: Math.max(0, Math.min(window.innerHeight - 44, dragRef.current.py + e.clientY - dragRef.current.sy)),
    };
    setPos(next);
    onPosChange(next);
  }, [onPosChange, size.w]);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  const onResizeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    sizeRef.current = { sx: e.clientX, sy: e.clientY, w: size.w, h: size.h };
  }, [size]);
  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!sizeRef.current) return;
    const next = {
      w: Math.max(260, Math.min(560, sizeRef.current.w + e.clientX - sizeRef.current.sx)),
      h: Math.max(140, Math.min(640, sizeRef.current.h + e.clientY - sizeRef.current.sy)),
    };
    setSize(next);
    onSizeChange(next);
  }, [onSizeChange]);
  const onResizeUp = useCallback(() => { sizeRef.current = null; }, []);

  const filtered = searchQuery.trim()
    ? messages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  const textSizeClass = settings.fontSize === "sm" ? "text-xs" : settings.fontSize === "lg" ? "text-base" : "text-sm";
  const compact = settings.compactMessages;
  const isMac = settings.windowControls === "mac";

  const bgStyle: React.CSSProperties = settings.panelOpacity < 100
    ? {
        backgroundColor: `hsl(var(--card) / ${settings.panelOpacity}%)`,
        ...(settings.blurBackground ? { backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } : {}),
      }
    : {};

  return (
    <div className="fixed z-40 flex flex-col bg-card border border-border/50 rounded-2xl shadow-2xl overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: size.w, ...bgStyle }}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>

      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-1.5 bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary/60 rounded-2xl pointer-events-none">
          <Paperclip className="w-6 h-6 text-primary" />
          <span className="text-xs font-semibold text-primary">Drop files to share</span>
        </div>
      )}

      {/* Header (draggable) */}
      <div className={`flex items-center px-3 py-2 border-b border-border/20 cursor-grab active:cursor-grabbing select-none shrink-0 ${isMac ? "flex-row-reverse" : "justify-between"}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <div className={`flex items-center gap-2 ${isMac ? "ml-auto" : ""}`}>
          <MessageSquare className="w-3.5 h-3.5 text-primary/70" />
          <span className="text-xs font-semibold text-foreground/80">Chat</span>
          {searchQuery && filtered.length !== messages.length && (
            <span className="text-[10px] text-primary/60">{filtered.length}/{messages.length}</span>
          )}
        </div>
        {isMac ? (
          <div className="flex items-center gap-1.5">
            <button onClick={onClose} title="Close"
              className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-110 transition" />
            <button onClick={() => setMinimized(m => !m)} title={minimized ? "Expand" : "Minimize"}
              className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-110 transition" />
            <button onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery(""); }} title="Search"
              className={`w-3 h-3 rounded-full transition hover:brightness-110 ${showSearch ? "bg-[#28c840]" : "bg-[#28c840]/60"}`} />
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery(""); }}
              className={`p-1 rounded-md transition-colors ${showSearch ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
              <Search className="w-3 h-3" />
            </button>
            <button onClick={() => setMinimized(m => !m)}
              className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground transition-colors">
              {minimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            </button>
            <button onClick={onClose}
              className="p-1 rounded-md text-muted-foreground/40 hover:text-destructive transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {!minimized && (
        <>
          {/* Search bar */}
          {showSearch && (
            <div className="px-3 pt-2 shrink-0">
              <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Escape" && (setShowSearch(false), setSearchQuery(""))}
                placeholder="Search…"
                className="h-7 rounded-xl bg-muted/30 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-xs" />
            </div>
          )}

          {/* Messages */}
          <div style={{ height: minimized ? 0 : size.h }}>
            <ScrollArea className="h-full">
              <div className={`space-y-0.5 px-3 py-2 ${compact ? "space-y-0" : ""}`}>
                {hasMore && !searchQuery && (
                  <button onClick={onLoadMore} disabled={loadingMore}
                    className="w-full text-center text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 py-1 disabled:opacity-30">
                    {loadingMore ? "Loading…" : "↑ Load older"}
                  </button>
                )}
                {filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground/40 text-center py-4">
                    {searchQuery ? "No matches" : "No messages yet"}
                  </p>
                )}
                {filtered.map(msg => {
                  const isOwn = msg.userId === me.id;
                  const isHovered = hoveredMsgId === msg.id;
                  const isEditing = editingMsgId === msg.id;
                  const reactions: any[] = msg.reactions ?? [];
                  const timeStr = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                  return (
                    <div key={msg.id}
                      className={`relative group/msg -mx-1 px-1 rounded-lg hover:bg-muted/15 transition-colors ${compact ? "py-0.5" : "py-1"}`}
                      onMouseEnter={() => setHoveredMsgId(msg.id)}
                      onMouseLeave={() => setHoveredMsgId(null)}>
                      {isEditing ? (
                        <form onSubmit={onEditSave}>
                          <Input value={editContent} onChange={e => onEditContentChange(e.target.value)}
                            onKeyDown={e => e.key === "Escape" && onEditCancel()}
                            className="h-7 rounded-lg bg-muted/30 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-xs"
                            autoFocus />
                          <span className="text-[10px] text-muted-foreground/30 ml-0.5">Enter · Esc to cancel</span>
                        </form>
                      ) : (
                        <div className={`flex items-baseline flex-wrap gap-x-1 leading-relaxed ${textSizeClass}`}>
                          {settings.showTimestamps && (
                            <span className="text-[10px] text-muted-foreground/40 shrink-0">{timeStr}</span>
                          )}
                          {avatarSrc(msg.avatarUrl) && (
                            <img src={avatarSrc(msg.avatarUrl)!} alt=""
                              className="w-3.5 h-3.5 rounded-full object-cover self-center shrink-0" />
                          )}
                          <span className={`text-xs font-semibold shrink-0 ${chatColor(msg.userId)}`}>
                            {displayNameOf(msg) || msg.username}
                          </span>
                          <span className={`${textSizeClass} text-foreground/85`}>
                            <MessageContent content={msg.content} searchQuery={searchQuery} myUsername={me.username} />
                            {msg.editedAt && <span className="text-[10px] text-muted-foreground/30 ml-1">(edited)</span>}
                          </span>
                        </div>
                      )}
                      {/* Own message actions */}
                      {isOwn && !isEditing && isHovered && (
                        <div className="absolute right-1 top-0.5 flex items-center gap-0.5 bg-card border border-border/40 rounded-lg px-1 py-0.5 shadow-sm z-10">
                          <button onClick={() => onEditStart(msg.id, msg.content)}
                            className="p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={() => onDelete(msg.id)}
                            className="p-0.5 text-muted-foreground/40 hover:text-destructive transition-colors">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {/* Quick reactions */}
                      {isHovered && !isEditing && (
                        <div className="flex items-center gap-0.5 mt-0.5 flex-wrap">
                          {QUICK_REACTIONS.map(emoji => (
                            <button key={emoji} onClick={() => onReaction(msg.id, emoji)}
                              className="text-xs leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-primary/10 hover:scale-125 transition-all">
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                      {/* Reaction bubbles */}
                      {reactions.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          {reactions.map((r: any) => {
                            const isMine = (r.userIds as number[]).includes(me.id);
                            return (
                              <button key={r.emoji} onClick={() => onReaction(msg.id, r.emoji)}
                                className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${isMine ? "border-primary/50 bg-primary/10 text-primary" : "border-border/40 bg-muted/20 text-muted-foreground hover:border-primary/30"}`}>
                                <span>{r.emoji}</span>
                                <span className="ml-0.5">{r.count}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {/* Read receipts */}
                      {readersByMessage?.[msg.id]?.length ? (
                        <div className="flex items-center gap-0.5 mt-0.5">
                          {readersByMessage[msg.id].map(r => (
                            <div key={r.id} title={`Seen by ${r.username}`}
                              className={`w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold text-white ${avatarBg(r.id)}`}>
                              {r.username[0]?.toUpperCase()}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          </div>

          {/* Typing indicator */}
          {typingNames.length > 0 && (
            <div className="px-3 pb-1 shrink-0 flex items-center gap-1.5">
              <div className="flex gap-0.5 items-end">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1 h-1 rounded-full bg-muted-foreground/40"
                    style={{ animation: "typing-bounce 1s ease-in-out infinite", animationDelay: `${i * 200}ms` }} />
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground/50 truncate">
                {typingNames.length === 1 ? `${typingNames[0]} is typing` : `${typingNames[0]} +${typingNames.length - 1} typing`}
              </span>
            </div>
          )}

          {/* Input */}
          <div className="px-3 py-2.5 shrink-0 border-t border-border/15">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
            <div className="relative flex items-end gap-1">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!isConnected || isUploading}
                title="Attach file" className="mb-0.5 p-1.5 rounded-lg text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 shrink-0">
                {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
              </button>
              <div className="relative flex-1">
                <MentionInput
                  value={msgInput}
                  onChange={onMsgInputChange}
                  onSubmit={onSend}
                  members={members ?? []}
                  disabled={!isConnected}
                  placeholder="Message…"
                  onFilesPasted={onFiles}
                  className="rounded-xl bg-muted/25 border border-transparent focus-visible:border-primary/25 focus-visible:outline-none text-sm px-3 py-1.5 pr-7 placeholder:text-muted-foreground/40 text-foreground" />
                <button type="button" className="absolute right-2 bottom-1.5 text-muted-foreground/30">
                  <Smile className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {!minimized && (
        <div onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp}
          title="Drag to resize"
          className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-50 flex items-end justify-end p-0.5 text-muted-foreground/30 hover:text-muted-foreground/70">
          <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 fill-current"><path d="M9 1v8H7V3H1V1z" /></svg>
        </div>
      )}
    </div>
  );
}
