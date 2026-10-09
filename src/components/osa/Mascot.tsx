"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// La mascotte d'OsaNotch — version web « vivante ».
// - les yeux suivent le curseur (ou une cible `lookAt`), elle cligne
// - une humeur par situation (attente, travail, victoire, tristesse…)
// - des petits gestes quand elle s'ennuie (regarder autour, sautiller, saluer)
// - elle réagit quand on la touche, et parle dans une bulle
export type Mood =
  | "idle" | "happy" | "dance" | "sleep" | "think" | "sad"
  | "excited" | "search" | "work" | "cheer" | "love" | "wow";

type Props = {
  size?: number;
  mood?: Mood;
  wave?: boolean;
  glow?: string;
  say?: string | null;
  bubble?: "right" | "left" | "top";
  lookAt?: { x: number; y: number } | null;
  holding?: "file" | "screen" | "note" | null;
  interactive?: boolean;
  tricks?: boolean;
};

const INK = "#1b1d24";
const POKES = ["Hé ! 😆", "Ça chatouille !", "Oui oui, je suis là", "Encore ?", "Hihi", "Je travaille, moi !", "👋"];
type Trick = null | "look" | "hop" | "tilt" | "wave" | "poke" | "spin";

export default function Mascot({
  size = 64, mood = "idle", wave = false, glow, say = null, bubble = "right",
  lookAt = null, holding = null, interactive = true, tricks = true,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [eye, setEye] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [trick, setTrick] = useState<Trick>(null);
  const [pokeLine, setPokeLine] = useState<string | null>(null);
  const pokes = useRef<number[]>([]);
  // Sur petit écran, la bulle passe au-dessus (sinon elle déborde à droite).
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const f = () => setNarrow(mq.matches);
    f(); mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const side = narrow ? "top" : bubble;
  const target = useRef<{ x: number; y: number } | null>(null);

  // ── Regard : curseur ou cible imposée ──────────────────────────────────
  const aim = useCallback((px: number, py: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height * 0.5);
    const d = Math.max(1, Math.hypot(dx, dy));
    const k = Math.min(1, d / 360);
    setEye({ x: (dx / d) * 5 * k, y: (dy / d) * 4 * k });
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (!target.current) aim(e.clientX, e.clientY); };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [aim]);

  useEffect(() => {
    target.current = lookAt;
    if (lookAt) aim(lookAt.x, lookAt.y);
  }, [lookAt, aim]);

  // ── Clignements (parfois doubles, comme un vrai) ───────────────────────
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 120);
        if (Math.random() < 0.25) setTimeout(() => { setBlink(true); setTimeout(() => setBlink(false), 110); }, 260);
        loop();
      }, 2200 + Math.random() * 2600);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  // ── Petits gestes quand elle s'ennuie ──────────────────────────────────
  useEffect(() => {
    if (!tricks || (mood !== "idle" && mood !== "happy")) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        const pick: Trick[] = ["look", "hop", "tilt", "wave", "look", "hop"];
        const k = pick[Math.floor(Math.random() * pick.length)];
        setTrick(k);
        setTimeout(() => setTrick((c) => (c === k ? null : c)), k === "look" ? 2200 : 1500);
        loop();
      }, 5200 + Math.random() * 4800);
    };
    loop();
    return () => clearTimeout(t);
  }, [mood, tricks]);

  const poke = () => {
    if (!interactive) return;
    const now = Date.now();
    pokes.current = [...pokes.current.filter((p) => now - p < 2200), now];
    if (pokes.current.length >= 5) {
      pokes.current = [];
      setTrick("spin");
      setPokeLine("Wiiiiii !");
      setTimeout(() => setTrick(null), 900);
    } else {
      setTrick("poke");
      setPokeLine(POKES[Math.floor(Math.random() * POKES.length)]);
      setTimeout(() => setTrick((c) => (c === "poke" ? null : c)), 700);
    }
    setTimeout(() => setPokeLine(null), 1700);
  };

  // ── Humeur effective (les gestes priment brièvement) ───────────────────
  const m: Mood = trick === "poke" ? "wow" : mood;
  const happyEyes = m === "happy" || m === "dance" || m === "cheer" || m === "excited";
  const closed = m === "sleep";
  const isLook = trick === "look" || m === "search";
  const eyeX = m === "think" ? 4 : closed ? 0 : eye.x;
  const eyeY = m === "think" ? -5 : m === "sad" ? 3 : closed ? 0 : eye.y;

  // Corps : une boucle d'animation par humeur
  const bodyAnim: Record<Mood, { anim: any; dur: number }> = {
    idle: { anim: { y: [0, -1.5, 0], scaleY: [1, 1.025, 1], scaleX: [1, 0.99, 1] }, dur: 3 },
    happy: { anim: { y: [0, -6, 0], scaleY: [1, 1.03, 0.97, 1] }, dur: 0.75 },
    dance: { anim: { rotate: [-9, 9, -9], y: [0, -5, 0, -5, 0] }, dur: 0.7 },
    sleep: { anim: { scaleY: [1, 1.035, 1], y: [0, 0.5, 0] }, dur: 3.6 },
    think: { anim: { rotate: [-6, -3, -6], y: [0, -1, 0] }, dur: 2.6 },
    sad: { anim: { y: [3, 4, 3], scaleY: [0.96, 0.95, 0.96] }, dur: 3 },
    excited: { anim: { y: [0, -9, 0], scaleY: [1, 1.06, 0.92, 1] }, dur: 0.42 },
    search: { anim: { rotate: [-5, 5, -5], x: [-2, 2, -2] }, dur: 2.4 },
    work: { anim: { y: [0, -3.5, 0], rotate: [-3, 3, -3] }, dur: 0.34 },
    cheer: { anim: { y: [0, -18, 0, 0], scaleY: [1, 1.08, 0.86, 1], scaleX: [1, 0.95, 1.1, 1] }, dur: 0.75 },
    love: { anim: { y: [0, -4, 0], scale: [1, 1.04, 1] }, dur: 1 },
    wow: { anim: { scale: 1.06, y: -3 }, dur: 0.2 },
  };
  let { anim, dur } = bodyAnim[m];
  if (trick === "hop") { anim = { y: [0, -14, 0, -5, 0], scaleY: [1, 1.06, 0.9, 1.02, 1] }; dur = 0.9; }
  if (trick === "tilt") { anim = { rotate: [0, 10, 10, 0] }; dur = 1.4; }
  if (trick === "spin") { anim = { rotate: [0, 360], y: [0, -16, 0] }; dur = 0.8; }
  const hopping = ["happy", "excited", "cheer", "dance", "work", "love"].includes(m) || trick === "hop" || trick === "spin";
  const once = trick === "hop" || trick === "tilt" || trick === "spin" || m === "wow";

  // Bras (pivots aux épaules, derrière le corps). + = vers l'extérieur à gauche.
  const waving = wave || trick === "wave";
  const armL = m === "cheer" ? [150, 172, 150] : m === "excited" ? [110, 140, 110] : m === "dance" ? [30, 150, 30]
    : m === "sad" ? [6, 6] : holding ? [58, 58] : [20, 26, 20];
  const armR = m === "cheer" ? [-150, -172, -150] : m === "excited" ? [-110, -140, -110] : m === "dance" ? [-150, -30, -150]
    : waving ? [-160, -118, -160] : m === "think" ? [-140, -146, -140] : m === "sad" ? [-6, -6] : holding ? [-58, -58] : [-20, -26, -20];
  const armDur = waving ? 0.5 : m === "cheer" || m === "excited" ? 0.45 : m === "dance" ? 0.7 : 3;

  const text = pokeLine || say;
  const ox = 60, eyeL = 43, eyeR = 77, eyeYc = 62;

  return (
    <div
      ref={ref}
      className={`relative select-none ${interactive ? "cursor-pointer" : ""}`}
      style={{ width: size, height: size }}
      onClick={poke}
    >
      {glow && <div className="absolute inset-[-35%] rounded-full blur-2xl opacity-70 pointer-events-none" style={{ background: `radial-gradient(circle, ${glow}, transparent 65%)` }} />}

      <svg viewBox="-2 -8 124 124" className="absolute inset-0 w-full h-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="osa-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffdf8" />
            <stop offset="0.6" stopColor="#f1ece4" />
            <stop offset="1" stopColor="#d9d1c6" />
          </linearGradient>
        </defs>

        {/* ombre au sol : rétrécit quand elle saute */}
        <motion.ellipse cx={ox} cy={112} rx={30} ry={4.5} fill="rgba(0,0,0,0.38)"
          animate={hopping ? { scaleX: [1, 0.7, 1], opacity: [0.9, 0.5, 0.9] } : { scaleX: 1, opacity: 0.9 }}
          transition={{ duration: dur, repeat: once ? 0 : Infinity, ease: "easeInOut" }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }} />

        <motion.g animate={anim} transition={{ duration: dur, repeat: once ? 0 : Infinity, ease: "easeInOut" }}
          style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}>
          {/* bras */}
          {[{ x: 22, a: armL }, { x: 98, a: armR }].map((arm, i) => (
            <motion.g key={i} style={{ transformBox: "fill-box", transformOrigin: "50% 9%" }}
              animate={{ rotate: arm.a }} transition={{ duration: armDur, repeat: Infinity, ease: "easeInOut" }}>
              <rect x={arm.x - 5.5} y={63} width={11} height={33} rx={5.5} fill="#efe9df" />
            </motion.g>
          ))}

          {/* corps */}
          <rect x={18} y={26} width={84} height={80} rx={38} ry={37} fill="url(#osa-body)" />
          <ellipse cx={ox} cy={96} rx={30} ry={8} fill="rgba(0,0,0,0.05)" />

          {/* yeux */}
          <motion.g animate={isLook && m !== "search" ? { x: [eyeX, -5, -5, 5, 5, eyeX] } : m === "search" ? { x: [-5, 5, -5], y: -1 } : { x: eyeX, y: eyeY }}
            transition={isLook ? { duration: m === "search" ? 2.4 : 2.2, repeat: m === "search" ? Infinity : 0, ease: "easeInOut" } : { type: "spring", stiffness: 260, damping: 22 }}>
            {[eyeL, eyeR].map((cx) => (
              <g key={cx}>
                {m === "love" ? (
                  <path d={`M${cx} ${eyeYc + 7} C ${cx - 11} ${eyeYc - 1}, ${cx - 6} ${eyeYc - 10}, ${cx} ${eyeYc - 4} C ${cx + 6} ${eyeYc - 10}, ${cx + 11} ${eyeYc - 1}, ${cx} ${eyeYc + 7} Z`} fill="#ff5d7a" />
                ) : happyEyes ? (
                  <path d={`M${cx - 7} ${eyeYc + 3} Q ${cx} ${eyeYc - 7} ${cx + 7} ${eyeYc + 3}`} fill="none" stroke={INK} strokeWidth={3.4} strokeLinecap="round" />
                ) : closed ? (
                  <path d={`M${cx - 6} ${eyeYc} Q ${cx} ${eyeYc + 4} ${cx + 6} ${eyeYc}`} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
                ) : (
                  <motion.g animate={{ scaleY: blink ? 0.1 : 1 }} transition={{ duration: 0.08 }} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
                    <rect x={cx - (m === "wow" ? 8.5 : 7.5)} y={eyeYc - (m === "wow" ? 12 : 10.5)} width={m === "wow" ? 17 : 15} height={m === "wow" ? 24 : 21} rx={m === "wow" ? 8.5 : 7.5} fill={INK} />
                    <circle cx={cx + 2.6} cy={eyeYc - 4.5} r={m === "wow" ? 3.4 : 2.7} fill="#fff" />
                    <circle cx={cx - 2.4} cy={eyeYc + 3.5} r={1.1} fill="rgba(255,255,255,0.6)" />
                  </motion.g>
                )}
              </g>
            ))}
            {m === "sad" && [eyeL, eyeR].map((cx, i) => (
              <path key={cx} d={i === 0 ? `M${cx - 8} ${eyeYc - 12} L ${cx + 5} ${eyeYc - 16}` : `M${cx + 8} ${eyeYc - 12} L ${cx - 5} ${eyeYc - 16}`} stroke={INK} strokeWidth={2.4} strokeLinecap="round" opacity={0.7} />
            ))}
          </motion.g>

          {/* joues */}
          {(happyEyes || m === "love" || m === "wow" || trick === "poke") && [31, 89].map((cx) => (
            <ellipse key={cx} cx={cx} cy={78} rx={6.5} ry={3.6} fill="rgba(255,128,150,0.45)" />
          ))}

          {/* bouche */}
          <g transform={`translate(${eyeX * 0.3} 0)`}>
            {(m === "happy" || m === "dance" || m === "love") && (<>
              <path d="M52 79 Q60 91 68 79 Z" fill={INK} />
              <path d="M56 84 Q60 89 64 84 Q60 86 56 84 Z" fill="#ff8fa3" />
            </>)}
            {(m === "cheer" || m === "excited") && (<>
              <path d="M50 78 Q60 96 70 78 Z" fill={INK} />
              <path d="M55 86 Q60 93 65 86 Q60 88.5 55 86 Z" fill="#ff8fa3" />
            </>)}
            {m === "wow" && <ellipse cx={60} cy={84} rx={5} ry={6.5} fill={INK} />}
            {m === "idle" && <path d="M54 81 Q60 86 66 81" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />}
            {m === "sad" && <path d="M54 86 Q60 80 66 86" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />}
            {m === "think" && <path d="M56 84 L65 82.5" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />}
            {m === "search" && <ellipse cx={60} cy={83} rx={2.8} ry={3.4} fill={INK} />}
            {m === "work" && <path d="M54 83 Q60 81 66 83" fill="none" stroke={INK} strokeWidth={2.8} strokeLinecap="round" />}
            {m === "sleep" && <motion.ellipse cx={60} cy={84} rx={2.6} ry={1.6} fill={INK} initial={{ ry: 1.6 }} animate={{ ry: [1.6, 3, 1.6] }} transition={{ duration: 3.6, repeat: Infinity }} />}
          </g>

          {/* objet porté (OsaDrop : fichier, OsaCast : écran, OsaParty : note) */}
          {holding && (
            <g>
              {holding === "file" && (<>
                <path d="M48 86 h18 l7 7 v19 a3 3 0 0 1 -3 3 h-22 a3 3 0 0 1 -3 -3 v-23 a3 3 0 0 1 3 -3 z" fill="#ffffff" stroke="#d6d0c6" strokeWidth={1} />
                <path d="M66 86 v7 h7" fill="#e7e2d9" />
                <rect x={51} y={98} width={16} height={2.6} rx={1.3} fill="#c8c1b5" /><rect x={51} y={104} width={11} height={2.6} rx={1.3} fill="#c8c1b5" />
              </>)}
              {holding === "screen" && (<>
                <rect x={42} y={88} width={36} height={24} rx={4} fill="#14141a" stroke="#d6d0c6" strokeWidth={1.2} />
                <rect x={45} y={91} width={30} height={18} rx={2} fill="#a5b4fc" opacity={0.75} />
              </>)}
              {holding === "note" && <text x={60} y={110} textAnchor="middle" fontSize={24} fill={INK}>♪</text>}
              <circle cx={holding === "screen" ? 42 : 46} cy={100} r={5} fill="#efe9df" />
              <circle cx={holding === "screen" ? 78 : 74} cy={100} r={5} fill="#efe9df" />
            </g>
          )}

          {/* goutte de sueur au travail, larme quand triste */}
          {m === "work" && (
            <motion.path d="M100 40 q4 6 0 9 q-4 -3 0 -9 z" fill="#9fd3ff" animate={{ y: [0, 6], opacity: [0, 1, 0] }} transition={{ duration: 1.1, repeat: Infinity }} />
          )}
          {m === "sad" && (
            <motion.path d={`M${eyeL - 3} 74 q3 5 0 8 q-3 -3 0 -8 z`} fill="#9fd3ff" animate={{ y: [0, 10], opacity: [0, 1, 0] }} transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.6 }} />
          )}
        </motion.g>

        {/* décor autour */}
        {m === "sleep" && [0, 1].map((i) => (
          <motion.text key={i} x={96 + i * 8} y={30 - i * 10} fontSize={14 - i * 3} fontWeight={800} fill="rgba(255,255,255,0.6)"
            animate={{ opacity: [0, 1, 0], y: [0, -10, -20] }} transition={{ duration: 2.6, repeat: Infinity, delay: i * 1.2 }}>z</motion.text>
        ))}
        {m === "think" && [0, 1, 2].map((i) => (
          <motion.circle key={i} cx={98 + i * 7} cy={26 - i * 6} r={2.4 + i} fill="rgba(255,255,255,0.55)"
            animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.25 }} />
        ))}
        {(m === "cheer" || m === "excited") && [[6, 20], [112, 14], [0, 70], [118, 66], [60, -14]].map(([x, y], i) => (
          <motion.path key={i} d={`M${x} ${y - 6} L${x + 1.6} ${y - 1.6} L${x + 6} ${y} L${x + 1.6} ${y + 1.6} L${x} ${y + 6} L${x - 1.6} ${y + 1.6} L${x - 6} ${y} L${x - 1.6} ${y - 1.6} Z`}
            fill={i % 2 ? "#fcd34d" : "#fdfcf7"} style={{ transformBox: "fill-box", transformOrigin: "center" }}
            animate={{ scale: [0, 1.2, 0], rotate: [0, 90] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }} />
        ))}
        {m === "love" && [0, 1, 2].map((i) => (
          <motion.text key={i} x={20 + i * 40} y={20} fontSize={12} animate={{ y: [24, -10], opacity: [0, 1, 0] }} transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.6 }}>💗</motion.text>
        ))}
      </svg>

      {/* bulle de dialogue */}
      <AnimatePresence>
        {text && (
          <motion.div
            key={text}
            initial={{ opacity: 0, scale: 0.6, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.7, y: -4 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
            className="absolute z-10 pointer-events-none"
            style={
              side === "top"
                ? { bottom: "100%", left: "50%", marginBottom: 6, x: "-50%", transformOrigin: "50% 100%" }
                : side === "left"
                  ? { right: "92%", top: "-6%", transformOrigin: "100% 100%" }
                  : { left: "92%", top: "-6%", transformOrigin: "0% 100%" }
            }
          >
            <div className="relative bg-[#fdfcf7] text-[#111] font-semibold rounded-2xl px-3.5 py-2 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.6)] whitespace-nowrap"
              style={{ fontSize: Math.max(12, Math.min(15, size * 0.13)) }}>
              <Typed text={text} />
              <span className="absolute w-3 h-3 bg-[#fdfcf7] rotate-45"
                style={side === "top" ? { bottom: -5, left: "50%", marginLeft: -6 } : side === "left" ? { right: -4, bottom: 9 } : { left: -4, bottom: 9 }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Texte tapé lettre par lettre (la bulle « parle »).
function Typed({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const chars = Array.from(text);
    let i = 0;
    const t = setInterval(() => { i++; setN(i); if (i >= chars.length) clearInterval(t); }, 22);
    return () => clearInterval(t);
  }, [text]);
  const chars = Array.from(text);
  return (
    <span>
      {chars.slice(0, n).join("")}
      <span className="opacity-0">{chars.slice(n).join("")}</span>
    </span>
  );
}
