import React from "react";

export default function ChartCard({ title, children, subtitle }) {
  return (
    <div className="bg-white/5 border border-slate-700 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-slate-300">{title}</div>
          {subtitle && <div className="text-xs text-slate-500 mt-1">{subtitle}</div>}
        </div>
      </div>

      <div className="mt-4">{children}</div>
    </div>
  );
}
