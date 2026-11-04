import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = process.env.PORT || 3002;

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(handler);
  const io = new Server(httpServer, {
    cors: { origin: "*" },
    maxHttpBufferSize: 1e8, // 100 MB max for socket messages, though WebRTC handles the file
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // 1. Join a room
    socket.on("join-room", (roomId) => {
      const room = io.sockets.adapter.rooms.get(roomId);
      const numClients = room ? room.size : 0;

      if (numClients === 0) {
        socket.join(roomId);
        socket.emit("room-created", roomId);
      } else if (numClients === 1) {
        socket.join(roomId);
        socket.emit("room-joined", roomId);
        // Alert the first user that someone joined
        socket.to(roomId).emit("peer-connected", socket.id);
      } else {
        socket.emit("room-full", roomId);
      }
    });

    // 2. WebRTC Signaling (Offer, Answer, ICE Candidates)
    socket.on("offer", (payload) => {
      socket.to(payload.target).emit("offer", {
        sdp: payload.sdp,
        caller: socket.id
      });
    });

    socket.on("answer", (payload) => {
      socket.to(payload.target).emit("answer", {
        sdp: payload.sdp,
        answerer: socket.id
      });
    });

    socket.on("ice-candidate", (payload) => {
      socket.to(payload.target).emit("ice-candidate", {
        candidate: payload.candidate,
        sender: socket.id
      });
    });

    // 3. Amis OsaNotch : petits messages relayés d'un code à 6 chiffres à l'autre
    // (demande d'ami, acceptation, invitation OsaCast / OsaParty). Pas de WebRTC : le serveur
    // passe le message, et l'accusé dit à l'envoyeur si l'ami était connecté.
    const isCode = (c) => typeof c === "string" && /^\d{6}$/.test(c);
    socket.on("friend-listen", (code) => {
      if (!isCode(code)) return;
      socket.rooms.forEach((r) => { if (r.startsWith("friend_")) socket.leave(r); });
      socket.join("friend_" + code);
    });
    socket.on("friend-send", (p, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      if (!p || !isCode(p.to) || typeof p.msg !== "object" || p.msg === null) return reply(false);
      if (JSON.stringify(p.msg).length > 2000) return reply(false);
      const room = io.sockets.adapter.rooms.get("friend_" + p.to);
      if (!room || room.size === 0) return reply(false);
      socket.to("friend_" + p.to).emit("friend-msg", p.msg);
      reply(true);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      // Since rooms auto-leave on disconnect, we can broadcast peer-disconnected
      // Wait, we don't strictly track room IDs in socket object without iterating,
      // but socket.rooms is empty on disconnect event.
      // So let's use a disconnecting event
    });

    socket.on("disconnecting", () => {
      socket.rooms.forEach(room => {
        if (room !== socket.id) {
          socket.to(room).emit("peer-disconnected", socket.id);
        }
      });
    });
  });

  httpServer.once("error", (err) => {
    console.error(err);
    process.exit(1);
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
