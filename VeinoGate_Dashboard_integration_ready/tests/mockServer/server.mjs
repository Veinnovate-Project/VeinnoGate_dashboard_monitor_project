import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { validReading, abstainReading, recalibrateReading } from "./fixtures.mjs";

// TEST/DEMO-ONLY mock of the Jetson API+WebSocket. It implements the documented
// schemas so the dashboard's portability test can run against something real.
// It is never imported by production code and has no production entry point --
// start it explicitly with `npm run mock-server`.
if (process.env.ALLOW_MOCK_SERVER_IN_PRODUCTION === "true") {
  throw new Error("Refusing to start: mock server must never run with ALLOW_MOCK_SERVER_IN_PRODUCTION set.");
}

const PORT = Number(process.env.MOCK_SERVER_PORT ?? 8787);
let readingCounter = 0;

const http = createServer((req, res) => {
  if (req.url?.startsWith("/api/v1/sessions/") && req.url.endsWith("/snapshot")) {
    readingCounter += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(validReading(`mock_rd_${readingCounter}`)));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http, path: "/ws/v1" });

wss.on("connection", (socket) => {
  const sequence = [validReading, validReading, abstainReading, validReading, recalibrateReading, validReading];
  let step = 0;
  const interval = setInterval(() => {
    readingCounter += 1;
    const build = sequence[step % sequence.length];
    socket.send(JSON.stringify(build(`mock_rd_${readingCounter}`)));
    step += 1;
  }, 3000);
  socket.on("close", () => clearInterval(interval));
});

http.listen(PORT, () => {
  console.log(`[mock-jetson] listening on http://localhost:${PORT} (test/demo only)`);
});
