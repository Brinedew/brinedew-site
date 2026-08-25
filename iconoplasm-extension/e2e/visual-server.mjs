import { createReadStream, readFileSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const extensionRoot = resolve(fileURLToPath(import.meta.url), "..", "..")
const paperArgument = process.argv.find((argument) => argument.startsWith("--paper="))
const paperPath = resolve(String(paperArgument?.slice("--paper=".length) || ""))
const port = Number(process.env.ICONOPLASM_VISUAL_PORT || 4177)

if (!paperArgument || !statSync(paperPath).isFile()) {
  throw new Error("Pass an existing PDF as --paper=<absolute path>")
}

const contentTypes = {
  ".bcmap": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
}

function sendFile(response, path) {
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(path)] || "application/octet-stream",
    "Content-Length": statSync(path).size,
    "Cache-Control": "no-store",
  })
  createReadStream(path).pipe(response)
}

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`)
  if (url.pathname === "/paper.pdf") {
    sendFile(response, paperPath)
    return
  }
  if (url.pathname === "/") {
    const html = readFileSync(resolve(extensionRoot, "pdf-reader.html"), "utf8")
      .replace(
        '<script src="pdf-stream-bootstrap.js"></script>',
        '<script src="e2e/visual-browser-shim.js"></script>',
      )
      .replace('<script src="content.js"></script>', '<script src="e2e/visual-bridge.js"></script>')
    response.writeHead(200, {
      "Content-Type": contentTypes[".html"],
      "Content-Length": Buffer.byteLength(html),
      "Cache-Control": "no-store",
    })
    response.end(html)
    return
  }
  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "")
  const candidate = resolve(extensionRoot, relativePath)
  if (!candidate.startsWith(extensionRoot + sep)) {
    response.writeHead(403).end()
    return
  }
  try {
    sendFile(response, candidate)
  } catch {
    response.writeHead(404).end()
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`[iconoplasm-pdf-visual] http://127.0.0.1:${port}/`)
})
