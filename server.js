const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const HOST = "0.0.0.0";
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "links.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const FALLBACK_BASE_URL = `http://127.0.0.1:${PORT}`;

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "[]", "utf8");
  }
}

function readLinks() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

function writeLinks(links) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(links, null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
  };

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, "File not found");
      return;
    }

    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.socket.destroy();
        reject(new Error("Request too large"));
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function generateCode(existingCodes) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (!existingCodes.has(code)) {
      return code;
    }
  }

  throw new Error("Unable to generate unique short code");
}

function getRequestBaseUrl(req) {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = typeof forwardedProto === "string" ? forwardedProto.split(",")[0].trim() : "http";
  const host = req.headers.host;

  if (host) {
    return `${proto}://${host}`;
  }

  return FALLBACK_BASE_URL;
}

function getShortUrl(baseUrl, code) {
  return `${baseUrl}/${code}`;
}

const server = http.createServer(async (req, res) => {
  const baseUrl = getRequestBaseUrl(req);
  const requestUrl = new URL(req.url, baseUrl);
  const pathname = requestUrl.pathname;

  if (req.method === "GET" && pathname === "/") {
    sendFile(res, path.join(PUBLIC_DIR, "index.html"));
    return;
  }

  if (req.method === "GET" && pathname === "/styles.css") {
    sendFile(res, path.join(PUBLIC_DIR, "styles.css"));
    return;
  }

  if (req.method === "GET" && pathname === "/app.js") {
    sendFile(res, path.join(PUBLIC_DIR, "app.js"));
    return;
  }

  if (req.method === "GET" && pathname === "/api/links") {
    const links = readLinks()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((link) => ({
        ...link,
        shortUrl: getShortUrl(baseUrl, link.shortCode),
      }));

    sendJson(res, 200, { links });
    return;
  }

  if (req.method === "POST" && pathname === "/api/shorten") {
    try {
      const body = await parseBody(req);
      const originalUrl = typeof body.url === "string" ? body.url.trim() : "";

      if (!originalUrl || !isValidHttpUrl(originalUrl)) {
        sendJson(res, 400, { error: "유효한 http/https URL을 입력해 주세요." });
        return;
      }

      const links = readLinks();
      const existing = links.find((link) => link.originalUrl === originalUrl);

      if (existing) {
        sendJson(res, 200, {
          link: {
            ...existing,
            shortUrl: getShortUrl(baseUrl, existing.shortCode),
          },
        });
        return;
      }

      const shortCode = generateCode(new Set(links.map((link) => link.shortCode)));
      const newLink = {
        id: crypto.randomUUID(),
        originalUrl,
        shortCode,
        clickCount: 0,
        createdAt: new Date().toISOString(),
      };

      links.push(newLink);
      writeLinks(links);

      sendJson(res, 201, {
        link: {
          ...newLink,
          shortUrl: getShortUrl(baseUrl, shortCode),
        },
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "요청을 처리하지 못했습니다." });
    }
    return;
  }

  if (req.method === "GET" && pathname !== "/favicon.ico") {
    const shortCode = pathname.slice(1);
    if (shortCode) {
      const links = readLinks();
      const link = links.find((item) => item.shortCode === shortCode);

      if (!link) {
        sendText(res, 404, "Short link not found");
        return;
      }

      link.clickCount += 1;
      writeLinks(links);

      res.writeHead(302, { Location: link.originalUrl });
      res.end();
      return;
    }
  }

  sendText(res, 404, "Not found");
});

ensureDataFile();

server.listen(PORT, HOST, () => {
  console.log(`Shortlink app running on ${HOST}:${PORT}`);
});
