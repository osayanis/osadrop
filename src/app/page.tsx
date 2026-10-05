"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, CheckCircle2, FileUp, Loader2, ArrowRight, ShieldCheck, Key } from "lucide-react";
import { io, Socket } from "socket.io-client";

const CHUNK_SIZE = 64 * 1024; // 64 KB

export default function OsaDrop() {
  const [roomId, setRoomId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState<"idle" | "waiting" | "connected">("idle");
  const isInitiatorRef = useRef(false);
  
  // File Transfer States
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [transferStatus, setTransferStatus] = useState<"none" | "sending" | "receiving" | "done">("none");
  const [receivedFileMeta, setReceivedFileMeta] = useState<{name: string, size: number} | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  
  // Receive buffers
  const receiveBufferRef = useRef<ArrayBuffer[]>([]);
  const receivedSizeRef = useRef(0);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);

  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on("room-created", (id) => {
      setRoomId(id);
      setStatus("waiting");
      isInitiatorRef.current = true;
    });

    socketRef.current.on("room-joined", (id) => {
      setRoomId(id);
      setStatus("waiting");
      isInitiatorRef.current = false;
    });

    socketRef.current.on("room-full", () => {
      alert("Le salon est plein !");
      setStatus("idle");
    });

    socketRef.current.on("peer-connected", async () => {
      if (isInitiatorRef.current) {
        initiateWebRTC();
      }
    });

    socketRef.current.on("peer-disconnected", () => {
      alert("L'autre personne s'est déconnectée.");
      setStatus("idle");
      window.location.reload();
    });

    socketRef.current.on("offer", async (payload) => {
      if (!peerRef.current) initPeerConnection();
      await peerRef.current?.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      
      // Process queued candidates
      while (iceCandidateQueue.current.length > 0) {
        const candidate = iceCandidateQueue.current.shift();
        if (candidate) {
          await peerRef.current?.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
        }
      }

      const answer = await peerRef.current?.createAnswer();
      await peerRef.current?.setLocalDescription(answer);
      socketRef.current?.emit("answer", { target: payload.caller, sdp: peerRef.current?.localDescription });
    });

    socketRef.current.on("answer", async (payload) => {
      await peerRef.current?.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      
      // Process queued candidates
      while (iceCandidateQueue.current.length > 0) {
        const candidate = iceCandidateQueue.current.shift();
        if (candidate) {
          await peerRef.current?.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
        }
      }
    });

    socketRef.current.on("ice-candidate", async (payload) => {
      if (!peerRef.current || !peerRef.current.remoteDescription) {
        iceCandidateQueue.current.push(payload.candidate);
      } else {
        try {
          await peerRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (e) {
          console.error("Error adding received ice candidate", e);
        }
      }
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const initPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun1.l.google.com:19302" }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Broadcast candidate to peer in the room
        socketRef.current?.emit("ice-candidate", {
          target: roomId,
          candidate: event.candidate
        });
      }
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
    
    // Create Data Channel
    const dc = pc.createDataChannel("osadrop");
    dc.binaryType = "arraybuffer";
    setupDataChannelEvents(dc);
    dataChannelRef.current = dc;

    // Create Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit("offer", { target: roomId, sdp: pc.localDescription });
  };

  const setupDataChannelEvents = (dc: RTCDataChannel) => {
    dc.onopen = () => setStatus("connected");
    dc.onclose = () => setStatus("idle");
    
    dc.onmessage = (event) => {
      if (typeof event.data === "string") {
        const meta = JSON.parse(event.data);
        if (meta.type === "file-meta") {
          setReceivedFileMeta({ name: meta.name, size: meta.size });
          setTransferStatus("receiving");
          receiveBufferRef.current = [];
          receivedSizeRef.current = 0;
          setProgress(0);
        }
      } else if (event.data instanceof ArrayBuffer) {
        receiveBufferRef.current.push(event.data);
        receivedSizeRef.current += event.data.byteLength;
        
        if (receivedFileMeta) {
          setProgress(Math.round((receivedSizeRef.current / receivedFileMeta.size) * 100));
          
          if (receivedSizeRef.current === receivedFileMeta.size) {
            setTransferStatus("done");
            downloadFile(receiveBufferRef.current, receivedFileMeta.name);
          }
        }
      }
    };
  };

  const downloadFile = (buffers: ArrayBuffer[], name: string) => {
    const blob = new Blob(buffers);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendFile = async () => {
    if (!file || !dataChannelRef.current) return;
    
    const dc = dataChannelRef.current;
    if (dc.readyState !== "open") return alert("La connexion n'est pas prête.");

    setTransferStatus("sending");
    setProgress(0);

    // Send metadata
    dc.send(JSON.stringify({ type: "file-meta", name: file.name, size: file.size }));

    let offset = 0;
    const sendChunk = () => {
      while (offset < file.size) {
        if (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
          dc.onbufferedamountlow = () => {
            dc.onbufferedamountlow = null;
            sendChunk();
          };
          return;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        slice.arrayBuffer().then((buffer) => {
          dc.send(buffer);
        });

        offset += CHUNK_SIZE;
        setProgress(Math.round((offset / file.size) * 100));
      }

      if (offset >= file.size) {
        setTransferStatus("done");
      }
    };

    // Configure bufferedAmountLowThreshold (e.g. 1MB)
    dc.bufferedAmountLowThreshold = 1024 * 1024;
    sendChunk();
  };

  const createRoom = () => {
    const newId = Math.random().toString(36).substring(2, 8).toUpperCase();
    socketRef.current?.emit("join-room", newId);
  };

  const joinRoom = () => {
    if (joinCode.trim().length > 0) {
      socketRef.current?.emit("join-room", joinCode.trim().toUpperCase());
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center p-6 bg-[#050505]">
      
      <div className="fixed top-0 left-0 w-[500px] h-[500px] bg-blue-500/20 blur-[120px] rounded-full pointer-events-none z-0" />
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-purple-600/15 blur-[150px] rounded-full pointer-events-none z-0" />

      <div className="relative z-10 text-center mb-12">
        <h1 className="text-5xl font-black mb-4 tracking-tight">OsaDrop</h1>
        <div className="flex items-center justify-center gap-2 text-white/50 font-medium">
          <ShieldCheck className="w-5 h-5 text-green-400" />
          <span>Peer-to-Peer 100% sécurisé. Zéro stockage serveur.</span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        
        {/* IDLE STATE */}
        {status === "idle" && (
          <motion.div 
            key="idle"
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            className="w-full max-w-md glass-card rounded-3xl p-8 space-y-8"
          >
            <div>
              <h2 className="text-xl font-bold mb-2">Envoyer un fichier</h2>
              <button onClick={createRoom} className="w-full bg-white text-black font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-gray-200 transition">
                <UploadCloud className="w-5 h-5" /> Générer un code
              </button>
            </div>
            
            <div className="relative border-t border-white/10 pt-8">
              <h2 className="text-xl font-bold mb-4">Recevoir un fichier</h2>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Key className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
                  <input 
                    type="text" 
                    placeholder="Code à 6 lettres" 
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white uppercase font-bold tracking-widest focus:outline-none focus:border-blue-500 transition"
                    maxLength={6}
                  />
                </div>
                <button onClick={joinRoom} className="bg-blue-600 text-white px-6 rounded-xl font-bold hover:bg-blue-700 transition">
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* WAITING STATE */}
        {status === "waiting" && (
          <motion.div 
            key="waiting"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="text-center space-y-6"
          >
            <Loader2 className="w-16 h-16 text-blue-500 animate-spin mx-auto" />
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">En attente de connexion...</h2>
              <p className="text-white/50">Donnez ce code à votre contact :</p>
            </div>
            <div className="inline-block glass-card px-8 py-4 rounded-2xl border-blue-500/30 border-2">
              <span className="text-6xl font-black tracking-widest text-blue-400">{roomId}</span>
            </div>
          </motion.div>
        )}

        {/* CONNECTED STATE */}
        {status === "connected" && (
          <motion.div 
            key="connected"
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg glass-card rounded-3xl p-8"
          >
            <div className="flex items-center justify-center gap-3 mb-8 bg-green-500/10 text-green-400 py-2 rounded-full border border-green-500/20">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-sm font-bold tracking-wide">Connexion P2P Directe Établie</span>
            </div>

            {transferStatus === "none" && (
              <div className="space-y-6">
                <label className="border-2 border-dashed border-white/20 rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 hover:border-white/40 transition">
                  <FileUp className="w-12 h-12 text-white/50 mb-4" />
                  <span className="font-bold text-lg">{file ? file.name : "Cliquez ou glissez un fichier"}</span>
                  <span className="text-sm text-white/40 mt-2">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Taille illimitée (WebRTC)"}</span>
                  <input type="file" className="hidden" onChange={e => e.target.files && setFile(e.target.files[0])} />
                </label>
                
                <button 
                  onClick={sendFile}
                  disabled={!file}
                  className="w-full bg-blue-600 disabled:bg-white/10 disabled:text-white/30 text-white font-bold py-4 rounded-xl transition"
                >
                  Envoyer le fichier
                </button>
              </div>
            )}

            {(transferStatus === "sending" || transferStatus === "receiving") && (
              <div className="text-center space-y-6 py-8">
                <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto" />
                <h3 className="text-2xl font-bold">{transferStatus === "sending" ? "Envoi en cours..." : "Réception en cours..."}</h3>
                
                <div className="w-full bg-white/10 rounded-full h-4 overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-500 to-purple-500 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
                
                <div className="flex justify-between text-sm font-bold text-white/50">
                  <span>{progress}%</span>
                  <span>Direct P2P</span>
                </div>
              </div>
            )}

            {transferStatus === "done" && (
              <div className="text-center space-y-6 py-8">
                <CheckCircle2 className="w-20 h-20 text-green-400 mx-auto" />
                <h3 className="text-3xl font-black">Transfert terminé !</h3>
                <p className="text-white/50">Le fichier a été transféré avec succès via WebRTC.</p>
                <button onClick={() => {setFile(null); setTransferStatus("none");}} className="bg-white/10 hover:bg-white/20 text-white font-bold py-3 px-8 rounded-xl transition mt-4">
                  Envoyer un autre fichier
                </button>
              </div>
            )}
            
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
