import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * Collapsible section. Detail stays closed until asked for, so a screen answers
 * one question by default instead of presenting the whole evidence graph.
 *
 * `id` is what the numeric evidence strip jumps to: a reader who clicks
 * "2 contested" lands on the card that explains those two, already open.
 */
export function Card({
  id,
  title,
  lede,
  aside,
  children,
  open = false,
  plain = false,
}: {
  id?: string;
  title: string;
  lede?: string;
  aside?: ReactNode;
  children: ReactNode;
  open?: boolean;
  plain?: boolean;
}) {
  return (
    <details id={id} className={`card${plain ? ' plain' : ''}`} open={open}>
      <summary>
        <ChevronRight className="caret" />
        <h3>{title}</h3>
        {lede && <span className="lede">{lede}</span>}
        {aside}
      </summary>
      <div className="card-body">{children}</div>
    </details>
  );
}
