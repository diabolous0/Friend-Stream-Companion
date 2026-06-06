import { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";

interface Member { id: number; username: string }

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  members?: Member[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onFilesPasted?: (files: File[]) => void;
}

export interface MentionInputHandle {
  focus: () => void;
  insertText: (text: string) => void;
}

export const MentionInput = forwardRef<MentionInputHandle, MentionInputProps>(
  function MentionInput({ value, onChange, onSubmit, members = [], disabled, placeholder, className, onFilesPasted }, ref) {
    const taRef = useRef<HTMLTextAreaElement>(null);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionStart, setMentionStart] = useState(0);
    const [selectedIdx, setSelectedIdx] = useState(0);

    useImperativeHandle(ref, () => ({
      focus: () => taRef.current?.focus(),
      insertText: (text: string) => {
        const ta = taRef.current;
        if (!ta) return;
        const cursor = ta.selectionStart ?? value.length;
        const newVal = value.slice(0, cursor) + text + value.slice(cursor);
        onChange(newVal);
        requestAnimationFrame(() => { const p = cursor + text.length; ta.setSelectionRange(p, p); ta.focus(); });
      },
    }));

    const filtered = mentionQuery !== null
      ? members.filter(m => m.username.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 6)
      : [];

    const closeMention = useCallback(() => setMentionQuery(null), []);

    const insertMention = useCallback((username: string) => {
      const ta = taRef.current;
      const cursor = ta?.selectionStart ?? value.length;
      onChange(value.slice(0, mentionStart) + `@${username} ` + value.slice(cursor));
      closeMention();
      requestAnimationFrame(() => {
        const p = mentionStart + username.length + 2;
        ta?.setSelectionRange(p, p); ta?.focus();
      });
    }, [value, mentionStart, onChange, closeMention]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      onChange(val);
      resize(e.target);
      const cursor = e.target.selectionStart ?? val.length;
      const m = val.slice(0, cursor).match(/@([a-zA-Z0-9_]*)$/);
      if (m) { setMentionQuery(m[1]); setMentionStart(cursor - m[0].length); setSelectedIdx(0); }
      else closeMention();
    }, [onChange, closeMention]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionQuery !== null && filtered.length > 0) {
        if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
        if (e.key === "ArrowUp")   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); return; }
        if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); insertMention(filtered[selectedIdx].username); return; }
        if (e.key === "Escape") { closeMention(); return; }
      }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit?.(); }
    }, [mentionQuery, filtered, selectedIdx, insertMention, closeMention, onSubmit]);

    const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onFilesPasted) return;
      const files = Array.from(e.clipboardData.files);
      if (files.length > 0) { e.preventDefault(); onFilesPasted(files); }
    }, [onFilesPasted]);

    useEffect(() => { if (taRef.current) resize(taRef.current); }, [value]);

    useEffect(() => {
      const h = (e: MouseEvent) => {
        if (!taRef.current?.parentElement?.contains(e.target as Node)) closeMention();
      };
      document.addEventListener("mousedown", h);
      return () => document.removeEventListener("mousedown", h);
    }, [closeMention]);

    return (
      <div className="relative w-full">
        {mentionQuery !== null && filtered.length > 0 && (
          <div className="absolute bottom-full mb-1 left-0 min-w-[160px] bg-card border border-border/40 rounded-xl shadow-2xl overflow-hidden z-50">
            {filtered.map((m, i) => (
              <button key={m.id} type="button"
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${i === selectedIdx ? "bg-primary/15 text-primary" : "hover:bg-muted/30 text-foreground/80"}`}
                onMouseEnter={() => setSelectedIdx(i)}
                onMouseDown={e => { e.preventDefault(); insertMention(m.username); }}>
                <span className="font-mono text-[10px] text-muted-foreground/50">@</span>
                <span className="font-medium">{m.username}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className={`resize-none leading-5 block w-full ${className}`}
          style={{ minHeight: "2.5rem", maxHeight: "8rem", overflow: "hidden" }}
        />
      </div>
    );
  }
);

function resize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
}
