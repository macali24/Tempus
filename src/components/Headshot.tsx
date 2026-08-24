import { useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { headshotFor } from '../lib/headshots';
import { displayName } from '../lib/format';
import type { Provider } from '../types';

/**
 * A physician's face, or the reason there isn't one.
 *
 * The icon is not a loading state and not a stylistic default. It is the
 * honest answer whenever the photo cannot be tied to the record on screen.
 * `headshotFor` decides; this only renders. Hovering an icon says which of the
 * two silences it is: no audited photo exists for the NPI, or one exists and
 * the source names a different physician.
 *
 * A photo that 404s at runtime falls through to the same icon rather than
 * leaving a broken frame, since a missing face and an unverifiable one should
 * look identical to a rep scanning a queue.
 */
export function Headshot({
  provider,
  size = 'sm',
}: {
  provider: Provider;
  /** `sm` is the ranked queue; `lg` is the dossier header. */
  size?: 'sm' | 'lg';
}) {
  const [broken, setBroken] = useState(false);
  const result = headshotFor(provider);
  const className = `headshot headshot-${size}`;

  if (result.kind === 'photo' && !broken) {
    return (
      <img
        className={className}
        src={result.src}
        alt={`${displayName(provider)}, photographed for ${result.photo.publisher}`}
        title={`Photo: ${result.photo.publisher}`}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  }

  const reason =
    result.kind === 'withheld'
      ? result.reason
      : `No source-verified photo for NPI ${provider.number}`;

  return (
    <span
      className={`${className} is-icon${result.kind === 'withheld' ? ' is-withheld' : ''}`}
      title={reason}
      role="img"
      aria-label={reason}
    >
      <Stethoscope aria-hidden />
    </span>
  );
}

/**
 * The attribution line under the dossier photo. Separate from the image so the
 * queue can stay dense while the dossier, where a rep decides whether to trust
 * what they are looking at, carries the source and how identity was matched.
 */
export function HeadshotCredit({ provider }: { provider: Provider }) {
  const result = headshotFor(provider);
  if (result.kind !== 'photo') return null;

  const how =
    result.photo.evidence === 'npi-on-source-page'
      ? 'NPI on source page'
      : result.photo.evidence === 'npi-keyed-asset'
        ? 'NPI-keyed image path'
        : 'name and practice address';

  return (
    <a
      className="headshot-credit"
      href={result.photo.sourceUrl}
      target="_blank"
      rel="noreferrer"
      title={`${result.photo.sourceName}, identity matched by ${how}`}
    >
      {result.photo.publisher}
    </a>
  );
}
