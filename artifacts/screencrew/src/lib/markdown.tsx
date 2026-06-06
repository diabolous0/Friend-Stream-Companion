import React from "react";

type Token =
  | { t: "code_block"; lang: string; code: string }
  | { t: "bold"; children: Token[] }
  | { t: "italic"; children: Token[] }
  | { t: "code"; text: string }
  | { t: "link"; href: string; label: string }
  | { t: "mention"; username: string; isMe: boolean }
  | { t: "text"; text: string };

function tokeniseInline(raw: string, myUsername?: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "*" && raw[i + 1] === "*") {
      const end = raw.indexOf("**", i + 2);
      if (end !== -1) { tokens.push({ t: "bold", children: tokeniseInline(raw.slice(i + 2, end), myUsername) }); i = end + 2; continue; }
    }
    if (raw[i] === "*" && raw[i + 1] !== "*") {
      const end = raw.indexOf("*", i + 1);
      if (end !== -1) { tokens.push({ t: "italic", children: tokeniseInline(raw.slice(i + 1, end), myUsername) }); i = end + 1; continue; }
    }
    if (raw[i] === "`") {
      const end = raw.indexOf("`", i + 1);
      if (end !== -1) { tokens.push({ t: "code", text: raw.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (raw[i] === "[") {
      const lEnd = raw.indexOf("]", i + 1);
      if (lEnd !== -1 && raw[lEnd + 1] === "(") {
        const hEnd = raw.indexOf(")", lEnd + 2);
        if (hEnd !== -1) {
          const href = raw.slice(lEnd + 2, hEnd);
          if (/^https?:\/\//i.test(href)) {
            tokens.push({ t: "link", href, label: raw.slice(i + 1, lEnd) });
            i = hEnd + 1;
            continue;
          }
        }
      }
    }
    if (raw[i] === "@") {
      const m = raw.slice(i + 1).match(/^([a-zA-Z0-9_]+)/);
      if (m) { tokens.push({ t: "mention", username: m[1], isMe: m[1] === myUsername }); i += 1 + m[1].length; continue; }
    }
    if (raw.slice(i, i + 4) === "http") {
      const m = raw.slice(i).match(/^https?:\/\/[^\s)>\]]+/);
      if (m) { tokens.push({ t: "link", href: m[0], label: m[0] }); i += m[0].length; continue; }
    }
    const last = tokens[tokens.length - 1];
    if (last?.t === "text") last.text += raw[i]; else tokens.push({ t: "text", text: raw[i] });
    i++;
  }
  return tokens;
}

function tokenise(raw: string, myUsername?: string): Token[] {
  const result: Token[] = [];
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) result.push(...tokeniseInline(raw.slice(last, m.index), myUsername));
    result.push({ t: "code_block", lang: m[1].trim(), code: m[2] });
    last = m.index + m[0].length;
  }
  if (last < raw.length) result.push(...tokeniseInline(raw.slice(last), myUsername));
  return result;
}

function hlText(text: string, q: string): React.ReactNode {
  if (!q.trim()) return text;
  const parts: React.ReactNode[] = [];
  const lc = text.toLowerCase(), lq = q.toLowerCase();
  let start = 0, idx = lc.indexOf(lq);
  while (idx !== -1) {
    if (idx > start) parts.push(text.slice(start, idx));
    parts.push(<mark key={idx} className="bg-primary/30 text-foreground rounded-sm">{text.slice(idx, idx + q.length)}</mark>);
    start = idx + q.length; idx = lc.indexOf(lq, start);
  }
  if (start < text.length) parts.push(text.slice(start));
  return <>{parts}</>;
}

function renderToken(tok: Token, key: string | number, searchQuery: string, myUsername?: string): React.ReactNode {
  switch (tok.t) {
    case "code_block":
      return (
        <pre key={key} className="my-1 p-2 rounded-lg bg-muted/40 border border-border/30 overflow-x-auto text-xs font-mono leading-relaxed">
          <code>{tok.code}</code>
        </pre>
      );
    case "bold":
      return <strong key={key} className="font-semibold">{tok.children.map((c, i) => renderToken(c, i, searchQuery, myUsername))}</strong>;
    case "italic":
      return <em key={key} className="italic">{tok.children.map((c, i) => renderToken(c, i, searchQuery, myUsername))}</em>;
    case "code":
      return <code key={key} className="px-1 py-0.5 rounded bg-muted/50 border border-border/30 text-[11px] font-mono text-primary/90">{tok.text}</code>;
    case "link":
      return (
        <a key={key} href={tok.href} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="text-primary/80 underline underline-offset-2 hover:text-primary break-all transition-colors">
          {tok.label}
        </a>
      );
    case "mention":
      return (
        <span key={key} className={`font-semibold px-0.5 rounded ${tok.isMe ? "text-yellow-300 bg-yellow-400/15" : "text-primary/90 bg-primary/10"}`}>
          @{tok.username}
        </span>
      );
    case "text":
      return <React.Fragment key={key}>{searchQuery ? hlText(tok.text, searchQuery) : tok.text}</React.Fragment>;
    default: return null;
  }
}

type Segment =
  | { type: "text"; value: string }
  | { type: "image"; objectPath: string }
  | { type: "file"; objectPath: string; name: string };

const IMG_RE  = /\[screencrew:image:([^\]]+)\]/g;
const FILE_RE = /\[screencrew:file:([^:]+):([^\]]+)\]/g;

export function splitAttachments(content: string): Segment[] {
  const hits: Array<{ index: number; len: number; seg: Segment }> = [];
  let m: RegExpExecArray | null;
  IMG_RE.lastIndex = 0;
  while ((m = IMG_RE.exec(content)) !== null)
    hits.push({ index: m.index, len: m[0].length, seg: { type: "image", objectPath: m[1] } });
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(content)) !== null)
    hits.push({ index: m.index, len: m[0].length, seg: { type: "file", objectPath: m[1], name: m[2] } });
  hits.sort((a, b) => a.index - b.index);
  const segs: Segment[] = [];
  let last = 0;
  for (const h of hits) {
    if (h.index > last) segs.push({ type: "text", value: content.slice(last, h.index) });
    segs.push(h.seg);
    last = h.index + h.len;
  }
  if (last < content.length) segs.push({ type: "text", value: content.slice(last) });
  return segs.length ? segs : [{ type: "text", value: content }];
}

interface MessageContentProps {
  content: string;
  searchQuery?: string;
  myUsername?: string;
  className?: string;
}

export function MessageContent({ content, searchQuery = "", myUsername, className = "" }: MessageContentProps) {
  const segments = splitAttachments(content);
  return (
    <span className={`leading-relaxed break-words whitespace-pre-wrap ${className}`}>
      {segments.map((seg, si) => {
        if (seg.type === "image") {
          return (
            <span key={si} className="block my-1">
              <a href={`/api/storage${seg.objectPath}`} target="_blank" rel="noopener noreferrer">
                <img src={`/api/storage${seg.objectPath}`} alt="shared"
                  className="max-w-full max-h-48 rounded-lg border border-border/30 object-cover cursor-pointer hover:opacity-90 transition-opacity" />
              </a>
            </span>
          );
        }
        if (seg.type === "file") {
          return (
            <span key={si} className="block my-1">
              <a href={`/api/storage${seg.objectPath}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted/30 border border-border/30 text-xs text-primary/80 hover:bg-muted/50 transition-colors">
                📎 {seg.name}
              </a>
            </span>
          );
        }
        if (!seg.value?.trim() && segments.length > 1) return null;
        const tokens = tokenise(seg.value ?? "", myUsername);
        return (
          <React.Fragment key={si}>
            {tokens.map((tok, ti) => renderToken(tok, ti, searchQuery, myUsername))}
          </React.Fragment>
        );
      })}
    </span>
  );
}

export function containsMention(content: string, username: string): boolean {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escaped}\\b`, "i").test(content);
}
