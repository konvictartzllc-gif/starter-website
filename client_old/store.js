const state = {
  adminToken: sessionStorage.getItem("konvict_admin_token") || "",
  products: [],
  activeFilter: "all",
};

const API_BASE = document.querySelector('meta[name="api-base-url"]')?.content?.trim() || "";

function apiUrl(path) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

function esc(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.adminToken) {
    headers.Authorization = `Bearer ${state.adminToken}`;
  }

  const response = await fetch(apiUrl(path), {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function renderMode() {
  const isAdmin = Boolean(state.adminToken);
  const mode = document.getElementById("storeMode");
  const panel = document.getElementById("adminStorePanel");
  mode.textContent = isAdmin
    ? "Admin mode: you can add and remove inventory."
    : "Customer mode: browse available items and pricing.";
  panel.classList.toggle("hidden", !isAdmin);
}

function productCard(item) {
  const condition = (item.item_condition || "refurbished").toLowerCase() === "new" ? "New" : "Refurbished";
  const stock = Number.isFinite(Number(item.inventory)) ? Number(item.inventory) : 0;

  return `<div class="card">
    <img class="product-img" src="${esc(item.image)}" alt="${esc(item.name)}" />
    <h3>${esc(item.name)}</h3>
    <p class="store-price">$${Number(item.price).toFixed(2)}</p>
    <p class="meta">${condition} | ${stock} in stock</p>
    <p class="meta">Added ${new Date(item.created_at).toLocaleString()}</p>
    ${state.adminToken ? `<button class="danger" data-delete-product="${item.id}">Delete</button>` : ""}
  </div>`;
}

function renderProducts() {
  const list = document.getElementById("storeList");
  const filtered = state.products.filter((item) => {
    if (state.activeFilter === "all") {
      return true;
    }
    return (item.item_condition || "refurbished").toLowerCase() === state.activeFilter;
  });

  list.innerHTML = filtered.length
    ? filtered.map(productCard).join("")
    : "<p class='meta'>No products found for this filter.</p>";
}

async function refreshProducts() {
  state.products = await request("/api/products");
  renderProducts();
}

async function addProduct() {
  const name = document.getElementById("storeName").value.trim();
  const price = Number(document.getElementById("storePrice").value);
  const inventory = Number(document.getElementById("storeInventory").value);
  const itemCondition = document.getElementById("storeCondition").value;
  const image = document.getElementById("storeImage").value.trim();

  if (!name || !Number.isFinite(price) || !Number.isFinite(inventory) || !image) {
    throw new Error("Please fill all inventory fields.");
  }

  await request("/api/admin/products", {
    method: "POST",
    body: JSON.stringify({
      name,
      price,
      inventory,
      itemCondition,
      image,
    }),
  });

  document.getElementById("storeName").value = "";
  document.getElementById("storePrice").value = "";
  document.getElementById("storeInventory").value = "";
  document.getElementById("storeImage").value = "";
}

function wireEvents() {
  document.getElementById("storeAddBtn")?.addEventListener("click", async () => {
    const status = document.getElementById("storeStatus");
    try {
      await addProduct();
      await refreshProducts();
      status.textContent = "Inventory item added.";
    } catch (error) {
      status.textContent = error.message;
    }
  });

  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeFilter = btn.getAttribute("data-filter") || "all";
      renderProducts();
    });
  });

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const id = target.dataset.deleteProduct;
    if (!id) {
      return;
    }

    try {
      await request(`/api/admin/products/${id}`, { method: "DELETE" });
      await refreshProducts();
      document.getElementById("storeStatus").textContent = "Inventory item deleted.";
    } catch (error) {
      document.getElementById("storeStatus").textContent = error.message;
    }
  });
}

async function init() {
  renderMode();
  wireEvents();
  await refreshProducts();
}

init().catch((error) => {
  document.getElementById("storeStatus").textContent = error.message;
});
