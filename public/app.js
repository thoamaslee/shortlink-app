const form = document.querySelector("#shorten-form");
const urlInput = document.querySelector("#url-input");
const customCodeInput = document.querySelector("#custom-code-input");
const result = document.querySelector("#result");
const shortUrlLink = document.querySelector("#short-url");
const originalUrlText = document.querySelector("#original-url");
const message = document.querySelector("#message");
const copyButton = document.querySelector("#copy-button");
const refreshButton = document.querySelector("#refresh-button");
const linksList = document.querySelector("#links-list");
const emptyState = document.querySelector("#empty-state");
const authStatus = document.querySelector("#auth-status");
const googleSignin = document.querySelector("#google-signin");
const logoutButton = document.querySelector("#logout-button");

let currentShortUrl = "";
let currentUser = null;
let googleLoginEnabled = false;
let googleClientId = "";

function setMessage(text, isSuccess = false) {
  message.textContent = text;
  message.classList.toggle("success", isSuccess);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function renderResult(link) {
  currentShortUrl = link.shortUrl;
  shortUrlLink.href = link.shortUrl;
  shortUrlLink.textContent = link.shortUrl;
  originalUrlText.textContent = `원본 링크: ${link.originalUrl}`;
  result.classList.remove("hidden");
}

function getShortUserAgent(userAgent) {
  if (!userAgent) {
    return "알 수 없음";
  }
  return userAgent.length > 42 ? `${userAgent.slice(0, 42)}...` : userAgent;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setAuthStatus(text, isLoggedIn = false) {
  authStatus.textContent = text;
  authStatus.classList.toggle("logged-in", isLoggedIn);
}

function renderGoogleSignIn(attempt = 0) {
  if (!googleLoginEnabled || !googleClientId) {
    googleSignin.innerHTML = "<p class=\"auth-help\">GOOGLE_CLIENT_ID 환경변수를 설정하면 로그인 기능이 활성화됩니다.</p>";
    return;
  }

  if (!window.google?.accounts?.id) {
    if (attempt < 40) {
      setTimeout(() => renderGoogleSignIn(attempt + 1), 150);
      return;
    }
    googleSignin.innerHTML = "<p class=\"auth-help\">Google 로그인 스크립트를 불러오지 못했습니다. 새로고침해 주세요.</p>";
    return;
  }

  googleSignin.innerHTML = "";
  window.google.accounts.id.initialize({
    client_id: googleClientId,
    callback: async (response) => {
      try {
        const loginResponse = await fetch("/api/auth/google", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: response.credential }),
        });
        const data = await loginResponse.json();
        if (!loginResponse.ok) {
          setMessage(data.error || "로그인에 실패했습니다.");
          return;
        }
        currentUser = data.user;
        setAuthStatus(`${currentUser.name} (${currentUser.email}) 로그인됨`, true);
        logoutButton.classList.remove("hidden");
        await loadLinks();
      } catch (error) {
        setMessage("로그인 처리 중 오류가 발생했습니다.");
      }
    },
  });
  window.google.accounts.id.renderButton(googleSignin, {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "signin_with",
    width: 260,
  });
}

async function loadVisitLogs(shortCode, container) {
  container.innerHTML = "<p class=\"visit-log-item\">방문 로그를 불러오는 중...</p>";
  try {
    const response = await fetch(`/api/links/${encodeURIComponent(shortCode)}/visits`, {
      credentials: "include",
    });
    const data = await response.json();

    if (!response.ok) {
      container.innerHTML = `<p class="visit-log-item">${data.error || "방문 로그를 불러오지 못했습니다."}</p>`;
      return;
    }

    if (!data.visits.length) {
      container.innerHTML = "<p class=\"visit-log-item\">아직 방문 로그가 없습니다.</p>";
      return;
    }

    const lines = data.visits.map((visit) => {
      const ua = escapeHtml(getShortUserAgent(visit.userAgent));
      const ip = escapeHtml(visit.ip || "-");
      const when = escapeHtml(formatDate(visit.at));
      return `
        <div class="visit-log-item">
          <strong>${when}</strong>
          <span>IP: ${ip}</span>
          <span>UA: ${ua}</span>
        </div>
      `;
    });
    container.innerHTML = lines.join("");
  } catch (error) {
    container.innerHTML = "<p class=\"visit-log-item\">방문 로그를 불러오지 못했습니다.</p>";
  }
}

function renderLinks(links) {
  linksList.innerHTML = "";
  emptyState.classList.toggle("hidden", links.length > 0);

  links.forEach((link) => {
    const card = document.createElement("article");
    card.className = "link-card";
    card.innerHTML = `
      <div class="link-card-top">
        <div>
          <p><a href="${link.shortUrl}" target="_blank" rel="noreferrer">${link.shortUrl}</a></p>
          <p class="destination">${link.originalUrl}</p>
        </div>
        <div class="stats">
          <span>클릭 수</span>
          <strong>${link.clickCount}</strong>
          <small>로그 ${link.visitCount || 0}건</small>
        </div>
      </div>
      <p class="meta">생성일: ${formatDate(link.createdAt)}</p>
      ${
        currentUser
          ? `
      <div class="visit-log-box">
        <button type="button" class="secondary visit-log-button" data-code="${link.shortCode}">방문 로그 보기</button>
        <div class="visit-log-list hidden" id="log-${link.shortCode}"></div>
      </div>`
          : ""
      }
    `;
    linksList.appendChild(card);
  });

  if (currentUser) {
    document.querySelectorAll(".visit-log-button").forEach((button) => {
      button.addEventListener("click", async () => {
        const shortCode = button.dataset.code;
        const target = document.querySelector(`#log-${CSS.escape(shortCode)}`);
        const open = !target.classList.contains("hidden");
        if (open) {
          target.classList.add("hidden");
          button.textContent = "방문 로그 보기";
          return;
        }
        button.textContent = "방문 로그 숨기기";
        target.classList.remove("hidden");
        await loadVisitLogs(shortCode, target);
      });
    });
  }
}

async function loadAuthState() {
  const [configResponse, meResponse] = await Promise.all([
    fetch("/api/config"),
    fetch("/api/auth/me", { credentials: "include" }),
  ]);
  const configData = await configResponse.json();
  const meData = await meResponse.json();

  googleLoginEnabled = Boolean(configData.googleLoginEnabled);
  googleClientId = configData.googleClientId || "";
  currentUser = meData.user;

  if (currentUser) {
    setAuthStatus(`${currentUser.name} (${currentUser.email}) 로그인됨`, true);
    logoutButton.classList.remove("hidden");
  } else if (googleLoginEnabled) {
    setAuthStatus("방문 로그를 보려면 Google로 로그인하세요.");
  } else {
    setAuthStatus("Google 로그인이 비활성화되어 있습니다.");
  }

  renderGoogleSignIn();
}

async function loadLinks() {
  const response = await fetch("/api/links");
  const data = await response.json();
  renderLinks(data.links);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  const url = urlInput.value.trim();
  const customCode = customCodeInput.value.trim();
  if (!url) {
    setMessage("URL을 입력해 주세요.");
    return;
  }

  try {
    const response = await fetch("/api/shorten", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, customCode }),
    });

    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || "숏링크 생성에 실패했습니다.");
      return;
    }

    renderResult(data.link);
    setMessage("숏링크가 생성되었습니다.", true);
    urlInput.value = "";
    customCodeInput.value = "";
    await loadLinks();
  } catch (error) {
    setMessage("서버와 통신하지 못했습니다.");
  }
});

copyButton.addEventListener("click", async () => {
  if (!currentShortUrl) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentShortUrl);
    setMessage("숏링크를 복사했습니다.", true);
  } catch (error) {
    setMessage("복사에 실패했습니다.");
  }
});

refreshButton.addEventListener("click", async () => {
  setMessage("");
  await loadLinks();
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  currentUser = null;
  logoutButton.classList.add("hidden");
  setAuthStatus("로그아웃되었습니다. 방문 로그를 보려면 다시 로그인하세요.");
  renderGoogleSignIn();
  await loadLinks();
});

Promise.all([loadAuthState(), loadLinks()])
  .catch(() => {
    setMessage("초기 데이터를 불러오지 못했습니다.");
  });
