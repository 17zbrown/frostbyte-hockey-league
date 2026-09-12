/* tiny static server for the demo build: node tools/demo/serve.cjs <port> <dir> */
const http = require("http"), fs = require("fs"), path = require("path");
const port = +process.argv[2] || 8765, dir = process.argv[3] || process.cwd();
const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml", ".json":"application/json" };
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  const f = path.join(dir, u === "/" ? "demo.html" : u);
  fs.readFile(f, (err, buf) => {
    if (err){ res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  });
}).listen(port, () => console.log("demo server on http://localhost:" + port));
