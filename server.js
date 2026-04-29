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
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-session-secret-change-me";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_VISIT_LOGS_PER_LINK = 200;

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

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return raw.split(";").reduce((acc, item) => {
    const [key, ...rest] = item.trim().split("=");
    if (!key) {
      return acc;
    }
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createSessionToken(user) {
  const payload = {
    email: user.email,
    name: user.name || user.email,
    picture: user.picture || "",
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature || sign(encodedPayload) !== signature) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function getAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  return verifySessionToken(cookies.sid);
}

function isHttpsRequest(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.split(",")[0].trim() === "https") {
    return true;
  }
  return process.env.NODE_ENV === "production";
}

function setSessionCookie(res, token, req) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  const value = encodeURIComponent(token);
  res.setHeader(
    "Set-Cookie",
    `sid=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`
  );
}

function clearSessionCookie(res, req) {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

async function verifyGoogleIdToken(idToken) {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );

  if (!response.ok) {
    throw new Error("구글 토큰 검증에 실패했습니다.");
  }

  const payload = await response.json();
  const verified = payload.email_verified === true || payload.email_verified === "true";
  if (!verified) {
    throw new Error("이메일 인증이 완료된 계정만 로그인할 수 있습니다.");
  }

  if (GOOGLE_CLIENT_ID && payload.aud !== GOOGLE_CLIENT_ID) {
    throw new Error("허용되지 않은 Google Client ID입니다.");
  }

  return {
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture || "",
  };
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "";
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
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
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

function isValidCustomCode(value) {
  return /^[A-Za-z0-9_-]{3,20}$/.test(value);
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

function sanitizeLinkResponse(link, baseUrl) {
  const { visits, ...rest } = link;
  return {
    ...rest,
    shortUrl: getShortUrl(baseUrl, link.shortCode),
  };
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

  if (req.method === "GET") {
    const requestedPath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(PUBLIC_DIR, requestedPath);

    if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(res, filePath);
      return;
    }
  }

  if (req.method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, {
      googleClientId: GOOGLE_CLIENT_ID,
      googleLoginEnabled: Boolean(GOOGLE_CLIENT_ID),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/auth/me") {
    const user = getAuthenticatedUser(req);
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/google") {
    try {
      const body = await parseBody(req);
      const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";

      if (!idToken) {
        sendJson(res, 400, { error: "Google ID 토큰이 필요합니다." });
        return;
      }

      const user = await verifyGoogleIdToken(idToken);
      const sessionToken = createSessionToken(user);
      setSessionCookie(res, sessionToken, req);
      sendJson(res, 200, { user });
    } catch (error) {
      sendJson(res, 401, { error: error.message || "로그인에 실패했습니다." });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    clearSessionCookie(res, req);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/links") {
    const links = readLinks()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((link) => ({
        ...link,
        visits: undefined,
        visitCount: Array.isArray(link.visits) ? link.visits.length : 0,
        shortUrl: getShortUrl(baseUrl, link.shortCode),
      }));

    sendJson(res, 200, { links });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/links/") && pathname.endsWith("/visits")) {
    const user = getAuthenticatedUser(req);
    if (!user) {
      sendJson(res, 401, { error: "로그인이 필요합니다." });
      return;
    }

    const parts = pathname.split("/");
    const shortCode = parts[3];
    const links = readLinks();
    const link = links.find((item) => item.shortCode === shortCode);

    if (!link) {
      sendJson(res, 404, { error: "링크를 찾을 수 없습니다." });
      return;
    }

    const visits = Array.isArray(link.visits) ? link.visits : [];
    sendJson(res, 200, { visits: visits.slice(-30).reverse() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/shorten") {
    try {
      const body = await parseBody(req);
      const originalUrl = typeof body.url === "string" ? body.url.trim() : "";
      const customCode = typeof body.customCode === "string" ? body.customCode.trim() : "";

      if (!originalUrl || !isValidHttpUrl(originalUrl)) {
        sendJson(res, 400, { error: "유효한 http/https URL을 입력해 주세요." });
        return;
      }

      if (customCode && !isValidCustomCode(customCode)) {
        sendJson(res, 400, {
          error: "커스텀 코드는 3~20자의 영문, 숫자, -, _ 만 사용할 수 있습니다.",
        });
        return;
      }

      const links = readLinks();
      const existing = links.find((link) => link.originalUrl === originalUrl);

      if (existing) {
        if (customCode && existing.shortCode !== customCode) {
          sendJson(res, 409, {
            error: "해당 URL은 이미 다른 숏코드로 생성되어 있습니다.",
          });
          return;
        }

        sendJson(res, 200, {
          link: sanitizeLinkResponse(existing, baseUrl),
        });
        return;
      }

      const existingCodes = new Set(links.map((link) => link.shortCode));
      if (customCode && existingCodes.has(customCode)) {
        sendJson(res, 409, { error: "이미 사용 중인 커스텀 숏코드입니다." });
        return;
      }

      const shortCode = customCode || generateCode(existingCodes);
      const newLink = {
        id: crypto.randomUUID(),
        originalUrl,
        shortCode,
        clickCount: 0,
        visits: [],
        createdAt: new Date().toISOString(),
      };

      links.push(newLink);
      writeLinks(links);

      sendJson(res, 201, {
        link: sanitizeLinkResponse(newLink, baseUrl),
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
      if (!Array.isArray(link.visits)) {
        link.visits = [];
      }
      link.visits.push({
        at: new Date().toISOString(),
        ip: getClientIp(req),
        userAgent: req.headers["user-agent"] || "",
        referrer: req.headers.referer || "",
      });
      if (link.visits.length > MAX_VISIT_LOGS_PER_LINK) {
        link.visits = link.visits.slice(-MAX_VISIT_LOGS_PER_LINK);
      }
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
