const API_BASE = document.querySelector('meta[name="api-base-url"]')?.content?.trim() || "";

function apiUrl(path) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

function esc(value) {
  return String(value).replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function workCard(item) {
  return `<div class="card">
    <img class="work-img" src="${esc(item.image)}" alt="Past job photo" />
    <p class="meta">Added ${new Date(item.created_at).toLocaleString()}</p>
  </div>`;
}

async function init() {
  const status = document.getElementById("portfolioStatus");
  const grid = document.getElementById("portfolioGrid");

  try {
    const response = await fetch(apiUrl("/api/works"));
    const data = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error("Could not load portfolio right now.");
    }

    if (!Array.isArray(data) || data.length === 0) {
      grid.innerHTML = "<div class='card'><p class='meta'>No portfolio photos uploaded yet.</p></div>";
      status.textContent = "No photos uploaded yet.";
      return;
    }

    grid.innerHTML = data.map(workCard).join("");
    status.textContent = `${data.length} portfolio item(s)`;
  } catch (error) {
    status.textContent = error.message;
    grid.innerHTML = "<div class='card'><p class='meta'>Unable to load portfolio.</p></div>";
  }
}

init();
