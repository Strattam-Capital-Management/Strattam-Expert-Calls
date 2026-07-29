"use client";

import { FormEvent, ReactNode, useState } from "react";
import { useAuth } from "@/context/AuthContext";

export default function LoginGate({ children }: { children: ReactNode }) {
  const { isAuthed, isChecking, error, login } = useAuth();
  const [input, setInput] = useState("");

  if (isAuthed) return <>{children}</>;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    await login(input.trim());
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4">
      <div className="w-full rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Expert Interview Candidate Sourcing</h1>
        <p className="mt-1 text-sm text-slate-500">Enter the shared access code to continue.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Access code"
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={isChecking || !input.trim()}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isChecking ? "Checking..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
