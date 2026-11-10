'use client';

import { RANGE_PRESETS } from '@/lib/format';
import { Select } from './ui';

export function RangePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select aria-label="Rentang tanggal" className="h-8 w-36" value={value} onChange={(e) => onChange(e.target.value)}>
      {RANGE_PRESETS.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </Select>
  );
}
