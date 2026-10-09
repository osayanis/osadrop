"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Download, FileText, Plus, QrCode, Send, Share2, ShieldCheck, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Scanner } from "@yudiel/react-qr-scanner";
import { io, type Socket } from "socket.io-client";
import Mascot, { type Mood } from "@/components/osa/Mascot";
import { CodeSlots, Island, OsaBox, Pill, Shell, fmtBytes, useNotices } from "@/components/osa/Kit";

const CHUNK_SIZE = 64 * 1024; // 64 Ko
const ACCENT = "#7cc4ff";
const ACCENT2 = "#a78bfa";

type Status = "idle" | "waiting" | "connected";
type Transfer = "none" | "sending" | "receiving" | "done";
type Received = { name: string; size: number; url: string };

export default function OsaDrop() {
  // ── Session / signalisation (protocole inchangé : compatible OsaNotch) ──
  const [roomId, setRoomId] = useState("");
  const roomIdRef = useRef("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [isSender, setIsSender] = useState(false);
  const isInitiatorRef = useRef(false);

  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);

  // ── Transferts ──
  const [files, setFiles] = useState<File[]>([]);
  const filesRef = useRef<File[]>([]);
  filesRef.current = files;
  const [sentCount, setSentCount] = useState(0);
  const [transfer, setTransfer] = useState<Transfer>("none");
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [current, setCurrent] = useState<{ name: string; size: number } | null>(null);
  const [received, setReceived] = useState<Received[]>([]);
  const receivedFileMetaRef = useRef<{ name: string; size: number } | null>(null);
  const receiveBufferRef = useRef<ArrayBuffer[]>([]);
  const receivedSizeRef = useRef(0);
  const sample = useRef({ t: 0, bytes: 0, lastUi: 0, speed: 0 });
  const autoSend = useRef(false);

  // ── Interface ──
  const { notice, notify } = useNotices();
  const [showScanner, setShowScanner] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [hoverWhich, setHoverWhich] = useState<"send" | "recv" | null>(null);
  const [typing, setTyping] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [sad, setSad] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("https://osadrop.osalabs.fr");
  const pickRef = useRef<HTMLInputElement>(null);

  // Mesure du débit, mise à jour de l'interface au plus toutes les 120 ms.
  const track = (bytes: number, total: number, force = false) => {
    const now = performance.now();
    const s = sample.current;
    if (!s.t) { s.t = now; s.bytes = bytes; }
    const dt = (now - s.t) / 1000;
    if (dt > 0.4) {
      const inst = (bytes - s.bytes) / dt;
      s.speed = s.speed ? s.speed * 0.6 + inst * 0.4 : inst;
      s.t = now; s.bytes = bytes;
    }
    if (force || now - s.lastUi > 120) {
      s.lastUi = now;
      setProgress(Math.min(100, Math.round((bytes / Math.max(1, total)) * 100)));
      setSpeed(s.speed);
    }
  };
  const resetSample = () => { sample.current = { t: 0, bytes: 0, lastUi: 0, speed: 0 }; setSpeed(0); };

  // ── WebRTC ─────────────────────────────────────────────────────────────
  const downloadFile = (buffers: ArrayBuffer[], name: string) => {
    const blob = new Blob(buffers);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    return { url, size: blob.size };
  };

  const setupDataChannelEvents = (dc: RTCDataChannel) => {
    if (dc.readyState === "open") setStatus("connected");
    dc.onopen = () => setStatus("connected");
    dc.onclose = () => setStatus((s) => (s === "connected" ? "idle" : s));

    dc.onmessage = (event) => {
      if (typeof event.data === "string") {
        const meta = JSON.parse(event.data);
        if (meta.type === "file-meta") {
          const fileMeta = { name: meta.name, size: meta.size };
          receivedFileMetaRef.current = fileMeta;
          setCurrent(fileMeta);
          setTransfer("receiving");
          receiveBufferRef.current = [];
          receivedSizeRef.current = 0;
          setProgress(0);
          resetSample();
        }
      } else if (event.data instanceof ArrayBuffer) {
        receiveBufferRef.current.push(event.data);
        receivedSizeRef.current += event.data.byteLength;
        const meta = receivedFileMetaRef.current;
        if (meta) {
          track(receivedSizeRef.current, meta.size);
          if (receivedSizeRef.current >= meta.size) {
            track(meta.size, meta.size, true);
            const { url } = downloadFile(receiveBufferRef.current, meta.name);
            receiveBufferRef.current = [];
            setReceived((r) => [{ name: meta.name, size: meta.size, url }, ...r]);
            setTransfer("done");
            receivedFileMetaRef.current = null;
            setCelebrate(true);
            setTimeout(() => setCelebrate(false), 3200);
          }
        }
      }
    };
  };

  const initPeerConnection = () => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun1.l.google.com:19302" }] });
    pc.onicecandidate = (event) => {
      if (event.candidate) socketRef.current?.emit("ice-candidate", { target: roomIdRef.current, candidate: event.candidate });
    };
    pc.ondatachannel = (event) => {
      const receiveChannel = event.channel;
      receiveChannel.binaryType = "arraybuffer";
      setupDataChannelEvents(receiveChannel);
      dataChannelRef.current = receiveChannel;
    };
    peerRef.current = pc;
    return pc;
  };

  const initiateWebRTC = async () => {
    const pc = initPeerConnection();
    const dc = pc.createDataChannel("osadrop");
    dc.binaryType = "arraybuffer";
    setupDataChannelEvents(dc);
    dataChannelRef.current = dc;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit("offer", { target: roomIdRef.current, sdp: pc.localDescription });
  };

  const flushIce = async () => {
    while (iceCandidateQueue.current.length > 0) {
      const c = iceCandidateQueue.current.shift();
      if (c) await peerRef.current?.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
    }
  };

  // Nouvelle socket « propre » (aucun ancien salon) — utilisée au départ et après une déconnexion.
  const connect = useCallback(() => {
    socketRef.current?.disconnect();
    const s = io();
    socketRef.current = s;

    s.on("room-created", (id: string) => {
      setRoomId(id); roomIdRef.current = id;
      setStatus("waiting");
      isInitiatorRef.current = true; setIsSender(true);
    });
    s.on("room-joined", (id: string) => {
      setRoomId(id); roomIdRef.current = id;
      setStatus("waiting");
      isInitiatorRef.current = false; setIsSender(false);
    });
    s.on("room-full", () => {
      notify("Ce code est déjà utilisé par deux personnes", "🚫", "bad");
      setStatus("idle");
    });
    s.on("peer-connected", () => { if (isInitiatorRef.current) initiateWebRTC(); });
    s.on("peer-disconnected", () => {
      notify("L'autre personne s'est déconnectée", "🚪", "bad");
      setSad(true); setTimeout(() => setSad(false), 3500);
      endSession(false);
    });
    s.on("offer", async (payload: any) => {
      if (!peerRef.current) initPeerConnection();
      await peerRef.current?.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      await flushIce();
      const answer = await peerRef.current?.createAnswer();
      await peerRef.current?.setLocalDescription(answer);
      s.emit("answer", { target: payload.caller, sdp: peerRef.current?.localDescription });
    });
    s.on("answer", async (payload: any) => {
      await peerRef.current?.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      await flushIce();
    });
    s.on("ice-candidate", async (payload: any) => {
      if (!peerRef.current || !peerRef.current.remoteDescription) iceCandidateQueue.current.push(payload.candidate);
      else { try { await peerRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (e) { console.error(e); } }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify]);

  const endSession = (keepFiles: boolean) => {
    try { dataChannelRef.current?.close(); } catch {}
    try { peerRef.current?.close(); } catch {}
    dataChannelRef.current = null; peerRef.current = null;
    iceCandidateQueue.current = [];
    roomIdRef.current = ""; setRoomId("");
    isInitiatorRef.current = false; setIsSender(false);
    setStatus("idle"); setTransfer("none"); setProgress(0); setCurrent(null); setSentCount(0);
    if (!keepFiles) setFiles([]);
    autoSend.current = false;
    connect();
  };

  useEffect(() => {
    connect();
    setOrigin(window.location.origin);
    // Ouverture via QR / lien partagé : on rejoint directement le salon.
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (c.length >= 4) {
        setJoinCode(c);
        setTimeout(() => socketRef.current?.emit("join-room", c), 400);
        window.history.replaceState(null, "", window.location.pathname);
      }
    }
    return () => { socketRef.current?.disconnect(); };
  }, [connect]);

  // ── Envoi (file d'attente de fichiers, envoyés l'un après l'autre) ─────
  const sendOne = async (file: File, dc: RTCDataChannel) => {
    dc.send(JSON.stringify({ type: "file-meta", name: file.name, size: file.size }));
    let offset = 0;
    dc.bufferedAmountLowThreshold = 1024 * 1024; // 1 Mo
    resetSample();
    while (offset < file.size) {
      if (dc.readyState !== "open") throw new Error("canal fermé");
      if (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
        await new Promise<void>((resolve) => {
          let done = false;
          const timeout = setTimeout(() => { if (!done) { done = true; dc.onbufferedamountlow = null; resolve(); } }, 1000);
          dc.onbufferedamountlow = () => { if (!done) { done = true; clearTimeout(timeout); dc.onbufferedamountlow = null; resolve(); } };
        });
      }
      const buffer = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      try { dc.send(buffer); }
      catch { await new Promise((r) => setTimeout(r, 500)); dc.send(buffer); }
      offset += CHUNK_SIZE;
      track(Math.min(offset, file.size), file.size);
      if (offset % (CHUNK_SIZE * 100) === 0) await new Promise((r) => setTimeout(r, 1));
    }
    track(file.size, file.size, true);
  };

  const sendAll = async () => {
    const dc = dataChannelRef.current;
    const list = filesRef.current.slice(sentCount);
    if (!dc || !list.length) return;
    if (dc.readyState !== "open") { notify("La connexion n'est pas encore prête", "⏳", "bad"); return; }
    setTransfer("sending");
    try {
      for (const f of list) {
        setCurrent({ name: f.name, size: f.size });
        setProgress(0);
        await sendOne(f, dc);
        setSentCount((n) => n + 1);
      }
      setTransfer("done");
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 3200);
    } catch (e) {
      console.error("[OsaDrop] transfert interrompu " + String((e as any)?.name) + ": " + String((e as any)?.message));
      notify("Le transfert a été interrompu", "⚠️", "bad");
      setTransfer("none");
    }
  };

  // Fichiers choisis pendant l'attente → partent dès que la connexion s'ouvre.
  useEffect(() => {
    if (status === "connected" && isSender && autoSend.current && files.length > sentCount && transfer !== "sending") {
      autoSend.current = false;
      sendAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isSender, files.length]);

  const addFiles = (list: FileList | File[] | null) => {
    const arr = Array.from(list || []).filter((f) => f.size >= 0);
    if (!arr.length) return;
    setFiles((f) => [...f, ...arr]);
    if (transfer === "done") setTransfer("none");
    if (status === "idle") {
      // Glisser/choisir des fichiers depuis l'accueil = créer un salon d'envoi.
      autoSend.current = true;
      createRoom();
    } else if (status === "waiting") autoSend.current = true;
  };

  const createRoom = () => {
    const newId = Math.random().toString(36).substring(2, 8).toUpperCase();
    socketRef.current?.emit("join-room", newId);
  };
  const joinRoom = (code = joinCode) => {
    const c = code.trim().toUpperCase();
    if (c.length >= 4) socketRef.current?.emit("join-room", c);
  };

  // Glisser-déposer n'importe où sur la page (côté envoyeur).
  useEffect(() => {
    let depth = 0;
    const canDrop = () => status === "idle" || isInitiatorRef.current;
    const enter = (e: DragEvent) => { if (!e.dataTransfer?.types.includes("Files") || !canDrop()) return; depth++; setDragOver(true); };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragOver(false); };
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    const drop = (e: DragEvent) => { e.preventDefault(); depth = 0; setDragOver(false); if (canDrop()) addFiles(e.dataTransfer?.files || null); };
    window.addEventListener("dragenter", enter); window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragleave", leave); window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, transfer]);

  const link = `${origin}/?code=${roomId}`;
  const copyLink = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {} };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: "OsaDrop", text: `Récupère mon fichier sur OsaDrop (code ${roomId})`, url: link }); return; } catch {} }
    copyLink();
  };

  // ── La mascotte commente tout ──────────────────────────────────────────
  let mood: Mood = "idle";
  let say: string | null = "Glisse-moi un fichier !";
  let holding: "file" | null = null;
  if (sad) { mood = "sad"; say = "Il est parti…"; }
  else if (dragOver) { mood = "wow"; say = "Lâche-le, je l'attrape !"; }
  else if (celebrate) { mood = "cheer"; say = isSender ? "Livré ! 🎉" : "Reçu ! C'est téléchargé 🎉"; }
  else if (transfer === "sending" || transfer === "receiving") {
    mood = "work"; holding = "file";
    say = transfer === "sending" ? "Ça part ! 🚀" : "Ça arrive…";
  } else if (status === "waiting") {
    mood = "search";
    say = isSender ? (files.length ? "Ton fichier part dès qu'il arrive" : "J'attends ton ami…") : "Je toque à la porte…";
    if (isSender && files.length) holding = "file";
  } else if (status === "connected") {
    if (transfer === "done") { mood = "love"; say = isSender ? "Un autre ?" : "D'autres fichiers peuvent arriver"; }
    else { mood = isSender ? "excited" : "think"; say = isSender ? "Connectés ! Choisis tes fichiers" : "L'autre choisit son fichier…"; }
  } else if (typing) { mood = "think"; say = "Je t'écoute…"; }
  else if (hoverWhich === "send") { mood = "happy"; say = "Clique, ou glisse un fichier ici"; }
  else if (hoverWhich === "recv") { mood = "happy"; say = "Tape le code de ton ami"; }

  const islandStatus = status === "idle" ? "P2P · prêt" : status === "waiting" ? `code ${roomId}` : transfer === "sending" ? `envoi ${progress}%` : transfer === "receiving" ? `réception ${progress}%` : "connecté";
  const etaSec = current && speed > 0 ? Math.max(0, (current.size * (1 - progress / 100)) / speed) : null;

  return (
    <Shell
      app="osadrop" accent={ACCENT} accent2={ACCENT2}
      island={<Island title="OsaDrop" status={islandStatus} accent={ACCENT} live={status !== "idle"} notice={notice} />}
      right={status !== "idle" ? <Pill onClick={() => endSession(false)}><X className="w-4 h-4" /> <span className="hidden sm:inline">Terminer</span></Pill> : <Pill href="https://notch.osalabs.fr"><span className="hidden sm:inline">Aussi dans</span> OsaNotch</Pill>}
    >
      <input ref={pickRef} type="file" multiple className="hidden" onClick={(e) => { (e.target as HTMLInputElement).value = ""; }} onChange={(e) => addFiles(e.target.files)} />

      {/* voile de dépôt plein écran */}
      <AnimatePresence>
        {dragOver && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 pointer-events-none p-4 sm:p-8">
            <div className="w-full h-full rounded-[40px] border-2 border-dashed grid place-items-center bg-black/40 backdrop-blur-sm" style={{ borderColor: ACCENT }}>
              <p className="osa-display text-4xl sm:text-6xl font-extrabold">Lâche ici.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 w-full max-w-[920px] mx-auto px-4 sm:px-6 pt-6 sm:pt-10 flex flex-col items-center">
        {/* la mascotte, toujours là */}
        <div className="relative mt-6">
          <Mascot size={status === "idle" ? 128 : 104} mood={mood} say={say} holding={holding} lookAt={hover} glow={`${ACCENT}55`} bubble="right" />
        </div>

        <AnimatePresence mode="wait">
          {status === "idle" && (
            <motion.section key="idle" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="w-full flex flex-col items-center">
              <h1 className="osa-display text-center font-extrabold leading-[0.95] mt-6" style={{ fontSize: "clamp(40px, 7vw, 76px)" }}>
                Envoie un fichier.<br /><span className="text-white/40">Directement.</span>
              </h1>
              <p className="text-white/55 text-center mt-5 max-w-[520px] text-lg">D'un appareil à l'autre, sans compte et sans passer par un serveur.</p>
              <div className="flex flex-wrap justify-center gap-2 mt-6">
                {["Pair-à-pair", "Chiffré de bout en bout", "Sans limite de taille", "Compatible OsaNotch"].map((c) => (
                  <span key={c} className="text-xs font-semibold text-white/60 bg-white/[0.05] border border-white/[0.08] rounded-full px-3 py-1.5 flex items-center gap-1.5">
                    {c === "Chiffré de bout en bout" && <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />}{c}
                  </span>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-4 sm:gap-5 w-full mt-10">
                <OsaBox as="button" accent={ACCENT} onClick={() => pickRef.current?.click()} onHover={(p) => { setHover(p); setHoverWhich(p ? "send" : null); }} className="min-h-[260px]">
                  <div className="h-full flex flex-col items-center justify-center text-center p-7 gap-4">
                    <motion.div className="w-16 h-16 rounded-full bg-white/[0.08] grid place-items-center" whileHover={{ rotate: -12 }}>
                      <Send className="w-7 h-7" />
                    </motion.div>
                    <div>
                      <p className="osa-display text-2xl font-bold">Envoyer</p>
                      <p className="text-sm text-white/50 mt-1.5">Choisis des fichiers, ou glisse-les<br />n'importe où sur la page</p>
                    </div>
                    <span className="mt-1 text-xs font-bold bg-[#fdfcf7] text-black rounded-full px-4 py-2">Choisir des fichiers</span>
                    <span onClick={(e) => { e.stopPropagation(); createRoom(); }} className="text-xs text-white/40 underline underline-offset-4 decoration-white/20 hover:text-white">ou juste générer un code</span>
                  </div>
                </OsaBox>

                <OsaBox accent={ACCENT} onHover={(p) => { setHover(p); setHoverWhich(p ? "recv" : null); }} active={typing} className="min-h-[260px]">
                  <div className="h-full flex flex-col items-center justify-center text-center p-7 gap-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/45">Recevoir</p>
                    <CodeSlots value={joinCode} onChange={(v) => { setJoinCode(v); if (v.length === 6) joinRoom(v); }} accent={ACCENT} onFocusChange={setTyping} />
                    <div className="flex gap-2">
                      <button onClick={() => joinRoom()} disabled={joinCode.length < 4} className="h-10 px-5 rounded-full bg-[#fdfcf7] text-black text-sm font-bold disabled:opacity-30 transition">Recevoir</button>
                      <button onClick={() => setShowScanner(true)} className="h-10 px-4 rounded-full bg-white/[0.07] hover:bg-white/[0.12] text-sm font-semibold flex items-center gap-2 transition"><QrCode className="w-4 h-4" /> Scanner</button>
                    </div>
                    <p className="text-[11px] text-white/35">Code à 6 caractères (4 depuis OsaNotch)</p>
                  </div>
                </OsaBox>
              </div>
            </motion.section>
          )}

          {status === "waiting" && (
            <motion.section key="waiting" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="w-full flex flex-col items-center mt-8">
              {isSender ? (
                <div className="grid md:grid-cols-[1.1fr_0.9fr] gap-5 w-full">
                  <OsaBox accent={ACCENT} active>
                    <div className="p-7 flex flex-col items-center text-center gap-5">
                      <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/45">Donne ce code à ton ami</p>
                      <div className="flex gap-1.5 sm:gap-2">
                        {roomId.split("").map((ch, i) => (
                          <motion.span key={i} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: i * 0.06 }}
                            className="w-11 h-14 sm:w-14 sm:h-16 rounded-2xl grid place-items-center font-mono text-2xl sm:text-3xl font-bold bg-white/[0.06] border border-white/10">{ch}</motion.span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={copyLink} className="h-10 px-4 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-sm font-semibold flex items-center gap-2 transition">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? "Lien copié" : "Copier le lien"}</button>
                        <button onClick={share} className="h-10 w-10 rounded-full bg-[#fdfcf7] text-black grid place-items-center" aria-label="Partager"><Share2 className="w-4 h-4" /></button>
                      </div>
                      <div className="bg-[#fdfcf7] rounded-3xl p-4"><QRCodeSVG value={link} size={150} bgColor="#fdfcf7" fgColor="#111111" /></div>
                      <p className="text-xs text-white/35">Scanne-le avec l'appareil photo : la page s'ouvre déjà connectée.</p>
                    </div>
                  </OsaBox>
                  <OsaBox accent={ACCENT}>
                    <div className="p-6 h-full flex flex-col">
                      <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/45 mb-3">À envoyer</p>
                      <FileList files={files} sentCount={0} />
                      <button onClick={() => pickRef.current?.click()} className="mt-3 w-full rounded-2xl border-[1.5px] border-dashed border-white/15 hover:border-white/35 py-4 text-sm font-semibold text-white/60 hover:text-white flex items-center justify-center gap-2 transition">
                        <Plus className="w-4 h-4" /> {files.length ? "Ajouter des fichiers" : "Choisir maintenant (ils partiront tout seuls)"}
                      </button>
                    </div>
                  </OsaBox>
                </div>
              ) : (
                <OsaBox accent={ACCENT} className="w-full max-w-[460px]">
                  <div className="p-8 text-center">
                    <p className="osa-display text-2xl font-bold">Connexion à <span className="font-mono">{roomId}</span>…</p>
                    <p className="text-sm text-white/50 mt-2">On établit un lien direct entre vos deux appareils.</p>
                    <div className="mt-6 h-1.5 rounded-full bg-white/10 overflow-hidden"><motion.div className="h-full w-1/3 rounded-full" style={{ background: ACCENT }} animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} /></div>
                  </div>
                </OsaBox>
              )}
            </motion.section>
          )}

          {status === "connected" && (
            <motion.section key="connected" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="w-full max-w-[620px] mt-8">
              <OsaBox accent={ACCENT} active={transfer === "sending" || transfer === "receiving"}>
                <div className="p-6 sm:p-7">
                  <div className="flex items-center justify-between mb-5">
                    <span className="flex items-center gap-2 text-xs font-bold text-emerald-300 bg-emerald-400/10 rounded-full px-3 py-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Lien direct établi</span>
                    <span className="font-mono text-xs text-white/35">#{roomId}</span>
                  </div>

                  {(transfer === "sending" || transfer === "receiving") && current && (
                    <div className="mb-6">
                      <div className="flex items-end justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-xs text-white/45 font-semibold">{transfer === "sending" ? `Envoi${files.length > 1 ? ` · ${Math.min(sentCount + 1, files.length)}/${files.length}` : ""}` : "Réception"}</p>
                          <p className="font-semibold truncate mt-0.5">{current.name}</p>
                        </div>
                        <p className="osa-display text-5xl font-extrabold leading-none tabular-nums">{progress}<span className="text-2xl text-white/40">%</span></p>
                      </div>
                      <div className="mt-4 h-2 rounded-full bg-white/10 overflow-hidden">
                        <motion.div className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT2})` }} animate={{ width: `${progress}%` }} transition={{ ease: "linear", duration: 0.15 }} />
                      </div>
                      <div className="flex justify-between mt-2 text-xs text-white/40 font-mono">
                        <span>{speed ? `${fmtBytes(speed)}/s` : "…"}</span>
                        <span>{etaSec != null ? (etaSec < 60 ? `${Math.ceil(etaSec)} s restantes` : `${Math.ceil(etaSec / 60)} min restantes`) : fmtBytes(current.size)}</span>
                      </div>
                    </div>
                  )}

                  {isSender ? (
                    <>
                      {files.length > 0 ? <FileList files={files} sentCount={sentCount} active={transfer === "sending" ? sentCount : -1} /> : (
                        <button onClick={() => pickRef.current?.click()} className="w-full rounded-3xl border-[1.5px] border-dashed border-white/15 hover:border-white/35 py-12 flex flex-col items-center gap-3 text-white/60 hover:text-white transition">
                          <Plus className="w-8 h-8" /><span className="font-semibold">Choisis ou glisse des fichiers</span><span className="text-xs text-white/35">Taille illimitée</span>
                        </button>
                      )}
                      {files.length > 0 && transfer !== "sending" && (
                        <div className="flex gap-2 mt-4">
                          <button onClick={() => pickRef.current?.click()} className="h-12 px-5 rounded-full bg-white/[0.07] hover:bg-white/[0.12] font-semibold text-sm flex items-center gap-2 transition"><Plus className="w-4 h-4" /> Ajouter</button>
                          <button onClick={sendAll} disabled={files.length <= sentCount} className="flex-1 h-12 rounded-full bg-[#fdfcf7] text-black font-bold flex items-center justify-center gap-2 disabled:opacity-30 hover:scale-[1.01] active:scale-[0.98] transition">
                            <Send className="w-4 h-4" /> {files.length > sentCount ? `Envoyer ${files.length - sentCount > 1 ? `${files.length - sentCount} fichiers` : "le fichier"}` : "Tout est envoyé ✓"}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {received.length === 0 && transfer !== "receiving" && (
                        <div className="text-center py-8"><p className="osa-display text-xl font-bold">Prêt à recevoir</p><p className="text-sm text-white/45 mt-1">Les fichiers se téléchargent automatiquement.</p></div>
                      )}
                      {received.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/45">Reçus</p>
                          {received.map((r, i) => (
                            <motion.div key={r.url} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i === 0 ? 0 : 0 }} className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
                              <span className="w-10 h-10 rounded-xl bg-emerald-400/10 grid place-items-center"><Check className="w-5 h-5 text-emerald-300" /></span>
                              <div className="min-w-0 flex-1"><p className="font-semibold text-sm truncate">{r.name}</p><p className="text-xs text-white/40">{fmtBytes(r.size)}</p></div>
                              <a href={r.url} download={r.name} className="h-9 w-9 rounded-full bg-white/[0.08] hover:bg-white/[0.15] grid place-items-center" title="Télécharger à nouveau"><Download className="w-4 h-4" /></a>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </OsaBox>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      {/* Scanner QR */}
      <AnimatePresence>
        {showScanner && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xl grid place-items-center p-6">
            <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }} className="w-full max-w-sm rounded-[32px] overflow-hidden bg-black border border-white/10">
              <div className="p-4 pl-6 flex justify-between items-center">
                <p className="osa-display font-bold text-lg">Scanner le code</p>
                <button onClick={() => setShowScanner(false)} className="w-9 h-9 rounded-full bg-white/10 grid place-items-center hover:bg-white/20"><X className="w-4 h-4" /></button>
              </div>
              <div className="aspect-square bg-black">
                <Scanner
                  onScan={(result: any) => {
                    if (result && result.length > 0) {
                      const val: string = result[0].rawValue;
                      if (val.includes("?code=")) {
                        const code = val.split("?code=")[1].substring(0, 6).toUpperCase();
                        setShowScanner(false);
                        setJoinCode(code);
                        setTimeout(() => joinRoom(code), 400);
                      }
                    }
                  }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Shell>
  );
}

function FileList({ files, sentCount, active = -1 }: { files: File[]; sentCount: number; active?: number }) {
  if (!files.length) return <p className="text-sm text-white/35 py-6 text-center flex-1">Aucun fichier pour l'instant.</p>;
  return (
    <div className="space-y-2 max-h-[280px] overflow-y-auto osa-scroll pr-1 flex-1">
      {files.map((f, i) => {
        const done = i < sentCount;
        return (
          <motion.div key={`${f.name}-${i}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
            <span className={`w-10 h-10 rounded-xl grid place-items-center ${done ? "bg-emerald-400/10" : "bg-white/[0.06]"}`}>
              {done ? <Check className="w-5 h-5 text-emerald-300" /> : i === active ? <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white" /> : <FileText className="w-5 h-5 text-white/60" />}
            </span>
            <div className="min-w-0 flex-1"><p className="font-semibold text-sm truncate">{f.name}</p><p className="text-xs text-white/40">{fmtBytes(f.size)}</p></div>
          </motion.div>
        );
      })}
    </div>
  );
}
