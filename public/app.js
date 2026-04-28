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

let currentShortUrl = "";

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
        </div>
      </div>
      <p class="meta">생성일: ${formatDate(link.createdAt)}</p>
    `;
    linksList.appendChild(card);
  });
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

loadLinks().catch(() => {
  setMessage("링크 목록을 불러오지 못했습니다.");
});
