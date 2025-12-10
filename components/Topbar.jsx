import React from "react";
import { Bell, Search } from "lucide-react";

export default function Topbar({ title = "Admin Dashboard" }) {
  return (
    <header className="flex items-center justify-between py-4 px-6 bg-transparent border-b border-slate-200/5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">{title}</h1>
        <div className="text-sm text-slate-400">Monitor verifications & fraud</div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative hidden sm:flex">
          <input
            className="pl-10 pr-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 placeholder-slate-500"
            placeholder="Search by name / id / PAN"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <Search size={16} />
          </div>
        </div>

        <button className="p-2 rounded-lg hover:bg-white/5">
          <Bell size={18} />
        </button>

        <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-3 py-1 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-slate-900 font-bold">
            A
          </div>
          <div className="text-sm">
            <div className="text-slate-100">Admin</div>
            <div className="text-xs text-slate-400">Super Admin</div>
          </div>
        </div>
      </div>
    </header>
  );
}
