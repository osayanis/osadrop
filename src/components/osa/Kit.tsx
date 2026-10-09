"use client";

// Kit d'interface OsaLabs « façon OsaNotch » : partagé par OsaDrop, OsaCast et OsaParty.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type Notice = { id: number; text: string; icon?: string; tone?: "info" | "good" | "bad" | "game" };
export type App = "osadrop" | "osacast" | "osaparty";

export const APPS: { id: App | "osanotch"; name: string; href: string }[] = [
  { id: "osadrop", name: "OsaDrop", href: "https://osadrop.osalabs.fr" },
  { id: "osacast", name: "OsaCast", href: "https://osacast.osalabs.fr" },
  { id: "osaparty", name: "OsaParty", href: "https://osaparty.osalabs.fr" },
  { id: "osanotch", name: "OsaNotch", href: "https://notch.osalabs.fr" },
];

// File de notifications affichées une à une dans l'île (remplace les alert()).
export function useNotices() {
  const [list, setList] = useState<Notice[]>([]);
  useEffect(() => {
    if (!list.length) return;
    const t = setTimeout(() => setList((l) => l.slice(1)), 3200);
    return () => clearTimeout(t);
  }, [list]);
  const notify = useCallback((text: string, icon?: string, tone?: Notice["tone"]) => {
    setList((l) => [...l.slice(-3), { id: Date.now() + Math.random(), text, icon, tone }]);
  }, []);
  return { notice: list[0] || null, notify };
}

// L'île du haut de page, comme l'encoche d'OsaNotch.
export function Island({ title, status, accent, live, notice, onClick }: {
  title: string; status?: string; accent: string; live?: boolean; notice: Notice | null; onClick?: () => void;
}) {
  const tone = notice?.tone === "bad" ? "#f87171" : notice?.tone === "good" ? "#4ade80" : notice?.tone === "game" ? "#c4b5fd" : accent;
  return (
    <motion.button
      layout
      type="button"
      onClick={onClick}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className="relative bg-black text-white rounded-full border border-white/10 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.9)] flex items-center overflow-hidden h-11 px-4 cursor-default"
      style={{ minWidth: 180 }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {notice ? (
          <motion.div key={notice.id} initial={{ opacity: 0, y: 8, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            className="flex items-center gap-2.5 pr-1 whitespace-nowrap">
            <span className="w-6 h-6 rounded-full grid place-items-center text-[13px]" style={{ background: `${tone}33` }}>{notice.icon || "•"}</span>
            <span className="text-[13px] font-semibold max-w-[58vw] truncate">{notice.text}</span>
          </motion.div>
        ) : (
          <motion.div key="idle" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2.5 whitespace-nowrap w-full justify-center">
            <span className="relative flex w-2 h-2">
              {live && <span className="absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping" style={{ background: accent }} />}
              <span className="relative inline-flex rounded-full w-2 h-2" style={{ background: live ? accent : "rgba(255,255,255,0.35)" }} />
            </span>
            <span className="text-[13px] font-bold osa-display tracking-tight">{title}</span>
            {status && <span className="text-[12px] text-white/45 font-semibold">{status}</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

// Fond commun : grille « canvas » + halos de la couleur de l'app.
export function Backdrop({ accent, accent2 }: { accent: string; accent2?: string }) {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      <div className="absolute -top-48 left-1/2 -translate-x-1/2 w-[120vw] h-[65vh] rounded-full blur-[120px] opacity-[0.22] transition-colors duration-1000" style={{ background: `radial-gradient(circle, ${accent}, transparent 70%)` }} />
      <div className="absolute -bottom-40 -right-40 w-[60vw] h-[50vh] rounded-full blur-[120px] opacity-[0.10]" style={{ background: `radial-gradient(circle, ${accent2 || accent}, transparent 70%)` }} />
      <div className="absolute inset-0 osa-grid opacity-70 [mask-image:radial-gradient(ellipse_at_center,#000_25%,transparent_78%)]" />
    </div>
  );
}

// Cadre de page : fond, en-tête (OsaLabs · île · actions), pied de page.
export function Shell({ app, accent, accent2, island, right, children }: {
  app: App; accent: string; accent2?: string; island: ReactNode; right?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="relative min-h-[100dvh] bg-[#0a0a0c] text-white overflow-x-hidden flex flex-col" style={{ fontFamily: "var(--font-osa-sans), system-ui, sans-serif" }}>
      <Backdrop accent={accent} accent2={accent2} />
      <header className="relative z-30 grid grid-cols-[1fr_auto_1fr] items-start gap-3 px-4 sm:px-8 pt-4">
        <a href="https://osalabs.fr" className="justify-self-start h-11 pl-1.5 pr-4 rounded-full bg-white/[0.06] border border-white/10 hover:bg-white/10 flex items-center gap-2 text-sm font-semibold text-white/80 transition">
          <span className="w-8 h-8 rounded-full bg-black grid place-items-center">
            <span className="relative block w-[18px] h-[16px] rounded-[45%] bg-[#fdfcf7]">
              <span className="absolute w-[3px] h-[5px] rounded-full bg-[#1b1d24] top-[5px] left-[5px]" />
              <span className="absolute w-[3px] h-[5px] rounded-full bg-[#1b1d24] top-[5px] right-[5px]" />
            </span>
          </span>
          <span className="hidden sm:inline">OsaLabs</span>
        </a>
        <div className="relative flex justify-center">{island}</div>
        <div className="flex justify-end gap-2">{right}</div>
      </header>
      <main className="relative z-10 flex-1 flex flex-col">{children}</main>
      <footer className="relative z-10 px-6 pb-6 pt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-white/30">
        {APPS.map((a) => (
          <a key={a.id} href={a.href} className={`transition hover:text-white ${a.id === app ? "text-white/80" : ""}`}>{a.name}</a>
        ))}
        <span className="text-white/15">·</span>
        <a href="https://osalabs.fr" className="hover:text-white transition">par OsaLabs</a>
      </footer>
    </div>
  );
}

// Les boîtes en pointillés du notch, en version web.
export function OsaBox({ children, onClick, onHover, accent, active, className = "", as = "div" }: {
  children: ReactNode; onClick?: () => void; onHover?: (p: { x: number; y: number } | null) => void;
  accent: string; active?: boolean; className?: string; as?: "div" | "button" | "label";
}) {
  const ref = useRef<HTMLElement>(null);
  const Comp: any = motion[as];
  return (
    <Comp
      ref={ref}
      onClick={onClick}
      type={as === "button" ? "button" : undefined}
      onMouseEnter={() => { const r = ref.current?.getBoundingClientRect(); if (r && onHover) onHover({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); }}
      onMouseLeave={() => onHover?.(null)}
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      className={`group relative rounded-[30px] bg-black/60 backdrop-blur-xl p-2 text-left ${onClick || as !== "div" ? "cursor-pointer" : ""} ${className}`}
      style={{ boxShadow: active ? `0 30px 80px -30px ${accent}` : "0 30px 80px -40px rgba(0,0,0,0.9)" }}
    >
      <div className="relative h-full rounded-[24px] border-[1.5px] border-dashed transition-colors duration-300 overflow-hidden"
        style={{ borderColor: active ? accent : "rgba(255,255,255,0.16)" }}>
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `radial-gradient(circle at 50% 0%, ${accent}22, transparent 65%)` }} />
        <div className="relative h-full">{children}</div>
      </div>
    </Comp>
  );
}

// Saisie de code en cases (comme un code de vérification) : collage accepté.
export function CodeSlots({ length = 6, value, onChange, numeric, accent, autoFocus, onFocusChange }: {
  length?: number; value: string; onChange: (v: string) => void; numeric?: boolean; accent: string;
  autoFocus?: boolean; onFocusChange?: (focused: boolean) => void;
}) {
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const clean = (v: string) => (numeric ? v.replace(/\D/g, "") : v.toUpperCase().replace(/[^A-Z0-9]/g, "")).slice(0, length);
  return (
    <div className="relative" onClick={() => input.current?.focus()}>
      <input
        ref={input}
        value={value}
        autoFocus={autoFocus}
        inputMode={numeric ? "numeric" : "text"}
        autoCapitalize="characters"
        autoComplete="one-time-code"
        spellCheck={false}
        onChange={(e) => onChange(clean(e.target.value))}
        onFocus={() => { setFocus(true); onFocusChange?.(true); }}
        onBlur={() => { setFocus(false); onFocusChange?.(false); }}
        className="absolute inset-0 w-full h-full opacity-0 cursor-text"
        aria-label="Code"
        maxLength={length}
      />
      <div className="flex gap-1.5 sm:gap-2 justify-center pointer-events-none">
        {Array.from({ length }).map((_, i) => {
          const ch = value[i];
          const cur = focus && i === Math.min(value.length, length - 1);
          return (
            <motion.div key={i}
              animate={ch ? { scale: [1.18, 1], y: [-3, 0] } : { scale: 1 }}
              transition={{ duration: 0.22 }}
              className="w-10 h-12 sm:w-11 sm:h-14 rounded-2xl grid place-items-center font-mono text-xl sm:text-2xl font-bold bg-white/[0.05] border transition-colors"
              style={{ borderColor: cur ? accent : ch ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)", boxShadow: cur ? `0 0 0 4px ${accent}22` : "none" }}>
              {ch || (cur ? <span className="w-[2px] h-6 rounded-full animate-pulse" style={{ background: accent }} /> : <span className="text-white/15">·</span>)}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// Petit bouton pilule (actions d'en-tête).
export function Pill({ children, onClick, href, solid }: { children: ReactNode; onClick?: () => void; href?: string; solid?: boolean }) {
  const cls = `h-11 px-4 rounded-full text-sm font-semibold flex items-center gap-2 transition ${solid ? "bg-[#fdfcf7] text-black hover:scale-[1.03] active:scale-95" : "bg-white/[0.06] border border-white/10 hover:bg-white/10 text-white/80"}`;
  return href ? <a href={href} target="_blank" rel="noreferrer" className={cls}>{children}</a> : <button type="button" onClick={onClick} className={cls}>{children}</button>;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}
