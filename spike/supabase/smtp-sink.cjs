// Accepts any mail on :2525 and keeps the messages (so unconfirmed signups don't fail with "error sending email").
const net = require("net"); const fs = require("fs");
net.createServer((s) => {
  let data = false, buf = "";
  s.write("220 sink ESMTP\r\n");
  s.on("data", (d) => {
    buf += d.toString();
    if (data) { if (buf.endsWith("\r\n.\r\n")) { fs.appendFileSync("mail.log", buf + "\n-----\n"); buf = ""; data = false; s.write("250 queued\r\n"); } return; }
    for (const line of buf.split("\r\n").filter(Boolean)) {
      const c = line.slice(0, 4).toUpperCase();
      if (c === "EHLO" || c === "HELO") s.write("250-sink\r\n250 OK\r\n");
      else if (c === "DATA") { s.write("354 go\r\n"); data = true; buf = ""; return; }
      else if (c === "QUIT") { s.write("221 bye\r\n"); s.end(); }
      else s.write("250 OK\r\n");
    }
    buf = "";
  });
}).listen(2525, "0.0.0.0", () => console.log("smtp sink :2525"));
