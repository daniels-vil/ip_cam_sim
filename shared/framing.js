export function attachFramer(socket, onMsg) {
  let buf = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const ONE_MB = 1024 * 1024;
    while (buf.length >= 4) {
      const n = buf.readUInt32BE(0);
      if (n > ONE_MB) {
        socket.destroy(new Error("Control frame too large"));
        return;
      }
      if (buf.length < 4 + n) break;

      const slice = buf.subarray(4, 4 + n);
      buf = buf.subarray(4 + n);

      try {
        onMsg(JSON.parse(slice.toString("utf8")));
      } catch (e) {
        socket.emit("error", e);
      }
    }
  });
}

export function sendFrame(socket, obj) {
  if (!socket || socket.destroyed) return false;
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const hdr = Buffer.alloc(4);
  hdr.writeUInt32BE(body.length, 0);
  return socket.write(Buffer.concat([hdr, body]));
}
