import { createServer } from "node:http";

createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200);
    response.end("ok");
    return;
  }
  response.writeHead(503, { "content-type": "application/json" });
  response.end(JSON.stringify({ message: "unavailable" }));
}).listen(3528, "127.0.0.1");
