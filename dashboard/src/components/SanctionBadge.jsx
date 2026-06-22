import React from 'react';

const STYLES = {
  approved:   'bg-emerald-100 text-emerald-800 border-emerald-200',
  restricted: 'bg-amber-100   text-amber-800   border-amber-200',
  blocked:    'bg-rose-100    text-rose-800    border-rose-200',
  unknown:    'bg-slate-100   text-slate-700   border-slate-200',
};

export default function SanctionBadge({ status = 'unknown' }) {
  return (
    <span className={'inline-block px-2 py-0.5 text-xs font-medium rounded border ' + (STYLES[status] || STYLES.unknown)}>
      {status}
    </span>
  );
}
