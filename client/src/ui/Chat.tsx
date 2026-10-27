import { useEffect, useRef, useState } from 'react';
import type { ChatLine } from '../game/net';

export interface ChatProps {
  lines: ChatLine[];
  send: (text: string) => void;
  focusSignal?: number;
  onBlurInput?: () => void;
  /** Variante fija (sala) en vez de superpuesta al partido. */
  docked?: boolean;
}

export function Chat({ lines, send, focusSignal = 0, onBlurInput, docked }: ChatProps) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className={`chat ${docked ? 'docked' : 'overlay'} ${active ? 'active' : ''}`}>
      <div className="chat-log" ref={logRef}>
        {lines.slice(docked ? -60 : -8).map((l) => (
          // texto plano: React escapa el contenido, nunca se interpreta como HTML
          <div key={l.id} className={`chat-line ${l.from === null ? 'sys' : ''}`}>
            {l.from !== null && <b className={`nick ${l.team ?? ''}`}>{l.nick}: </b>}
            {l.text}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (t) send(t);
          setText('');
          if (!docked) inputRef.current?.blur();
        }}
      >
        <input
          ref={inputRef}
          value={text}
          maxLength={140}
          placeholder={docked ? 'Escribí un mensaje…' : 'Enter para chatear'}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setActive(true)}
          onBlur={() => {
            setActive(false);
            onBlurInput?.();
          }}
        />
      </form>
    </div>
  );
}
