'use client';

import { useState, useRef, useEffect } from 'react';
import { Info, X } from 'lucide-react';

export default function RubricFormatInfo() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); setOpen(!open); }}
        className="text-mauve hover:text-plum transition-colors"
        aria-label="Rubric format info"
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute left-1/2 -translate-x-1/2 top-6 z-50 w-72 rounded-xl border border-[var(--border)] bg-white shadow-lg p-4 text-left"
        >
          <div className="flex items-start justify-between mb-2">
            <span className="text-sm font-semibold text-ink">Rubric XLSX Format</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-mauve hover:text-ink transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="text-xs text-mauve mb-3">
            The spreadsheet should have these columns (case-insensitive):
          </p>

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left py-1 pr-2 text-ink font-medium">Column</th>
                <th className="text-left py-1 text-ink font-medium">Required</th>
              </tr>
            </thead>
            <tbody className="text-mauve">
              <tr className="border-b border-[var(--border)]">
                <td className="py-1.5 pr-2 font-mono text-ink">criterion</td>
                <td className="py-1.5">Yes</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-1.5 pr-2 font-mono text-ink">description</td>
                <td className="py-1.5">No</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="py-1.5 pr-2 font-mono text-ink">max_points</td>
                <td className="py-1.5">Yes ({">"} 0)</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2 font-mono text-ink">weight</td>
                <td className="py-1.5">No (default: 1)</td>
              </tr>
            </tbody>
          </table>

          <p className="text-xs text-mauve mt-3">
            If the workbook has a sheet named &quot;Rubric&quot;, that sheet is used. Otherwise the first sheet is read.
          </p>
        </div>
      )}
    </span>
  );
}
