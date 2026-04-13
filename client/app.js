const state = {
  token: sessionStorage.getItem("konvict_admin_token") || "",
  userToken: sessionStorage.getItem("konvict_user_token") || "",
  user: null,
  products: [],
  reviews: [],
  works: [],
  deals: [],
  bookings: [],
  dexChatOpen: false,
  dexMessages: [],
  cart: [],
};

import { dexVoice } from './voice.js';

// Update these 3 links when your Dex destinations are ready.
const DEX_LINKS = {
  web: "https://dex.konvictartz.com",
  // Temporary fallback until official store listings are published.
  ios: "https://dex.konvictartz.com",
  android: "https://dex.konvictartz.com",
};

const API_BASE = document.querySelector('meta[name="api-base-url"]')?.content?.trim() || "";

function apiUrl(path) {
  if (!API_BASE) {
    return path;
  }

  return `${API_BASE}${path}`;
}

const adminStoreForm = document.getElementById("adminStoreForm");
const adminWorkForm = document.getElementById("adminWorkForm");
const adminDealForm = document.getElementById("adminDealForm");
const adminStatus = document.getElementById("adminStatus");
const productFormTitle = document.getElementById("productFormTitle");
const addProductBtn = document.getElementById("addProductBtn");
const cancelProductEditBtn = document.getElementById("cancelProductEditBtn");
const uploadProductImageBtn = document.getElementById("uploadProductImageBtn");
const productImageFileInput = document.getElementById("productImageFile");
const productImageUploadStatus = document.getElementById("productImageUploadStatus");
let dexStatsIntervalId = null;
let dexCopyStatusTimeoutId = null;
let deferredInstallPrompt = null;
let editingProductId = null;

const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Ignore registration failures; install prompts still work on supported browsers.
    });
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButtonState();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  showDexToast("Dex app installed successfully.");
  updateInstallButtonState();
});

function updateInstallButtonState() {
  const installButtons = [
    document.getElementById("installDexHeaderBtn"),
    document.getElementById("downloadDexDesktopBtn"),
    document.getElementById("downloadDexIosBtn"),
    document.getElementById("downloadDexAndroidBtn"),
  ];

  if (isStandalone) {
    installButtons.forEach((button) => button?.classList.add("hidden"));
    return;
  }

  installButtons.forEach((button) => button?.classList.remove("hidden"));
}

function setAdminUi() {
  const isAdmin = Boolean(state.token);
  adminStoreForm.classList.toggle("hidden", !isAdmin);
  adminWorkForm.classList.toggle("hidden", !isAdmin);
  adminDealForm.classList.toggle("hidden", !isAdmin);
  document.getElementById("adminBookingList").classList.toggle("hidden", !isAdmin);
  adminStatus.textContent = isAdmin ? "Status: Logged in" : "Status: Logged out";
  document.getElementById("adminCodeGenForm").classList.toggle("hidden", !isAdmin);
  if (isAdmin) document.getElementById("generatedCodeDisplay").classList.add("hidden");
}

function setDexUi() {
  const isUser = Boolean(state.userToken);
  document.getElementById("dexAuthWall").classList.toggle("hidden", isUser);
  document.getElementById("dexContent").classList.toggle("hidden", !isUser);

  if (isUser && state.user) {
    document.getElementById("dexWelcome").textContent = `Welcome back, ${state.user.username}!`;
    updateReferralCard();
    startDexStatsAutoRefresh();
  } else {
    stopDexStatsAutoRefresh();
    document.getElementById("dexReferralCard").classList.add("hidden");
    hideDexCopyStatus();
  }
}

function startDexStatsAutoRefresh() {
  if (dexStatsIntervalId) {
    return;
  }

  dexStatsIntervalId = setInterval(() => {
    if (state.userToken && state.user?.referralCode) {
      updateReferralCard();
    }
  }, 30000);
}

function stopDexStatsAutoRefresh() {
  if (!dexStatsIntervalId) {
    return;
  }

  clearInterval(dexStatsIntervalId);
  dexStatsIntervalId = null;
}

function hideDexCopyStatus() {
  const statusEl = document.getElementById("dexCopyStatus");
  statusEl.classList.add("hidden");
  statusEl.textContent = "Copied";
}

async function updateReferralCard() {
  const card = document.getElementById("dexReferralCard");
  const codeEl = document.getElementById("dexReferralCode");
  const countEl = document.getElementById("dexReferralCount");
  const freeEl = document.getElementById("dexReferralFree");
  const linkEl = document.getElementById("dexReferralLink");

  const referralCode = state.user?.referralCode;
  if (!referralCode) {
    card.classList.add("hidden");
    hideDexCopyStatus();
    return;
  }

  const referralLink = `${window.location.origin}/?ref=${encodeURIComponent(referralCode)}`;
  linkEl.value = referralLink;
  codeEl.textContent = referralCode;

  try {
    const response = await fetch(apiUrl(`/api/dex/stats/${encodeURIComponent(referralCode)}`));
    const stats = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error("Could not load referral stats");
    }
    document.getElementById("dexSubscribedCount").textContent = String(stats.subscribedReferrals ?? 0);
    document.getElementById("dexEarnings").textContent = `$${((stats.earningsCents ?? 0) / 100).toFixed(2)}`;
    countEl.textContent = String(stats.referrals ?? 0);
    freeEl.textContent = stats.freeAccess ? "Yes" : "No";
  } catch {
    countEl.textContent = "-";
    document.getElementById("dexSubscribedCount").textContent = "-";
    document.getElementById("dexEarnings").textContent = "-";
    freeEl.textContent = "-";
  }

  card.classList.remove("hidden");
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
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

async function userApi(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.userToken) headers.Authorization = `Bearer ${state.userToken}`;
  const response = await fetch(apiUrl(path), { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function resetProductForm() {
  editingProductId = null;
  productFormTitle.textContent = "Add Product (Admin)";
  addProductBtn.textContent = "Add Product";
  cancelProductEditBtn.classList.add("hidden");
  document.getElementById("name").value = "";
  document.getElementById("description").value = "";
  document.getElementById("price").value = "";
  document.getElementById("image").value = "";
  document.getElementById("itemCondition").value = "new";
  document.getElementById("inventory").value = "";
  productImageFileInput.value = "";
  productImageUploadStatus.textContent = "";
}

function startProductEdit(productId) {
  const product = state.products.find((item) => Number(item.id) === Number(productId));
  if (!product) {
    alert("Product not found.");
    return;
  }

  editingProductId = Number(product.id);
  productFormTitle.textContent = `Edit Product #${product.id}`;
  addProductBtn.textContent = "Save Changes";
  cancelProductEditBtn.classList.remove("hidden");
  document.getElementById("name").value = product.name || "";
  document.getElementById("description").value = product.description || "";
  document.getElementById("price").value = product.price ?? "";
  document.getElementById("image").value = product.image || "";
  document.getElementById("itemCondition").value = (product.item_condition || "new").toLowerCase();
  document.getElementById("inventory").value = product.inventory ?? "";
  adminStoreForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function productCard(p) {
  const itemCondition = (p.item_condition || "refurbished").toLowerCase() === "new" ? "New" : "Refurbished";
  const inventory = Number.isFinite(Number(p.inventory)) ? Number(p.inventory) : 0;
  const inStock = inventory > 0;
  return `<div class="card">
      <img class="product-img" src="${p.image}" alt="${p.name}">
      <h3>${p.name}</h3>
      ${p.description ? `<p>${p.description}</p>` : ""}
      <p><strong>$${Number(p.price).toFixed(2)}</strong></p>
      <p class="meta">${itemCondition} &bull; ${inventory} in stock</p>
      <p class="meta">Added ${new Date(p.created_at).toLocaleString()}</p>
      ${state.token ? `<div class="actions"><button data-edit-product="${p.id}" class="secondary">Edit</button><button class="danger" data-delete-product="${p.id}">Delete</button></div>` : inStock ? `<button class="primary" data-add-to-cart="${p.id}" data-product-name="${p.name}" data-product-price="${p.price}" data-product-inventory="${p.inventory}">Add to Cart</button>` : `<button disabled>Out of Stock</button>`}
    </div>`;
}

function workCard(w) {
  return `<div class="card">
      <img class="work-img" src="${w.image}" alt="Work sample">
      <p class="meta">Added ${new Date(w.created_at).toLocaleString()}</p>
      ${state.token ? `<button class="danger" data-delete-work="${w.id}">Delete</button>` : ""}
    </div>`;
}

function reviewCard(r) {
  return `<div class="card">
      <p>${r.text}</p>
      <p class="meta">Posted ${new Date(r.created_at).toLocaleString()}</p>
      ${state.token ? `<button class="danger" data-delete-review="${r.id}">Delete</button>` : ""}
    </div>`;
}

function dealCard(d) {
  return `<div class="card">
      <p>${d.text}</p>
      <p class="meta">Posted ${new Date(d.created_at).toLocaleString()}</p>
      ${state.token ? `<button class="danger" data-delete-deal="${d.id}">Delete</button>` : ""}
    </div>`;
}

function bookingCard(b) {
  return `<div class="card booking-card">
      <p><strong>${b.name}</strong> &mdash; ${b.service}</p>
      <p class="meta">Date: ${b.booking_date} at ${b.booking_time}</p>
      <p class="meta">Phone: ${b.phone} &nbsp;|&nbsp; Email: ${b.email}</p>
      ${b.notes ? `<p class="meta">Notes: ${b.notes}</p>` : ""}
      <p class="meta">Requested ${new Date(b.created_at).toLocaleString()}</p>
      <button class="danger" data-delete-booking="${b.id}">Dismiss</button>
    </div>`;
}

function userBookingCard(b) {
  return `<div class="card booking-card">
      <p><strong>${esc(b.service)}</strong></p>
      <p class="meta">Date: ${esc(b.booking_date)} at ${esc(b.booking_time)}</p>
      ${b.notes ? `<p class="meta">Notes: ${esc(b.notes)}</p>` : ""}
      <p class="meta">Requested ${new Date(b.created_at).toLocaleString()}</p>
    </div>`;
}

function render() {
  document.getElementById("productList").innerHTML = state.products.map(productCard).join("");
  document.getElementById("workGallery").innerHTML = state.works.map(workCard).join("");
  document.getElementById("reviewsList").innerHTML = state.reviews.map(reviewCard).join("");
  document.getElementById("dealsList").innerHTML = state.deals.map(dealCard).join("");
  document.getElementById("bookingsList").innerHTML = state.bookings.map(bookingCard).join("");
  setAdminUi();
}

async function refreshAll() {
  const requests = [
    api("/api/products"),
    api("/api/reviews"),
    api("/api/works"),
    api("/api/deals"),
  ];

  if (state.token) {
    requests.push(api("/api/admin/bookings"));
  }

  const results = await Promise.allSettled(requests);
  state.products = results[0]?.status === "fulfilled" ? results[0].value : [];
  state.reviews = results[1]?.status === "fulfilled" ? results[1].value : [];
  state.works = results[2]?.status === "fulfilled" ? results[2].value : [];
  state.deals = results[3]?.status === "fulfilled" ? results[3].value : [];
  state.bookings = state.token && results[4]?.status === "fulfilled" ? results[4].value : [];
  render();
}

addProductBtn.addEventListener("click", async () => {
  try {
    const payload = {
      name: document.getElementById("name").value.trim(),
      description: document.getElementById("description").value.trim(),
      price: Number(document.getElementById("price").value),
      image: document.getElementById("image").value.trim(),
      itemCondition: document.getElementById("itemCondition").value,
      inventory: Number(document.getElementById("inventory").value) || 1,
    };

    if (editingProductId) {
      await api(`/api/admin/products/${editingProductId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/admin/products", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    resetProductForm();
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

cancelProductEditBtn.addEventListener("click", () => {
  resetProductForm();
});

uploadProductImageBtn.addEventListener("click", async () => {
  try {
    const file = productImageFileInput.files?.[0];
    if (!file) {
      productImageUploadStatus.textContent = "Select an image file first.";
      return;
    }

    const formData = new FormData();
    formData.append("image", file);

    const headers = {};
    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }

    const response = await fetch(apiUrl("/api/admin/upload-product-image"), {
      method: "POST",
      headers,
      body: formData,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Image upload failed");
    }

    document.getElementById("image").value = data.imagePath;
    productImageUploadStatus.textContent = `Uploaded: ${data.imagePath}`;
  } catch (err) {
    productImageUploadStatus.textContent = `Upload failed: ${err.message}`;
  }
});

document.getElementById("addWorkBtn").addEventListener("click", async () => {
  try {
    await api("/api/admin/works", {
      method: "POST",
      body: JSON.stringify({ image: document.getElementById("workImg").value.trim() }),
    });

    document.getElementById("workImg").value = "";
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("addDealBtn").addEventListener("click", async () => {
  try {
    await api("/api/admin/deals", {
      method: "POST",
      body: JSON.stringify({ text: document.getElementById("dealText").value.trim() }),
    });

    document.getElementById("dealText").value = "";
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("addReviewBtn").addEventListener("click", async () => {
  try {
    await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify({ text: document.getElementById("reviewText").value.trim() }),
    });

    document.getElementById("reviewText").value = "";
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("loginBtn").addEventListener("click", async () => {
  try {
    const tokenResponse = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("adminUser").value.trim(),
        password: document.getElementById("adminPass").value,
      }),
    });

    state.token = tokenResponse.token;
    sessionStorage.setItem("konvict_admin_token", state.token);
    document.getElementById("adminPass").value = "";
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  state.token = "";
  sessionStorage.removeItem("konvict_admin_token");
  resetProductForm();
  await refreshAll();
});

document.getElementById("clearAllBtn").addEventListener("click", async () => {
  if (!confirm("Clear all products, reviews, works, and deals?")) {
    return;
  }

  try {
    await api("/api/admin/clear-all", { method: "DELETE" });
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("generateCodeBtn").addEventListener("click", async () => {
  const email = document.getElementById("codeRecipientEmail").value.trim();
  const statusEl = document.getElementById("codeEmailStatus");
  const display = document.getElementById("generatedCodeDisplay");
  const value = document.getElementById("generatedCodeValue");

  try {
    if (!email) {
      throw new Error("Recipient email is required for promoter code generation.");
    }

    const payload = { email };
    const res = await api("/api/dex/generate-code", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    value.textContent = res.code;
    statusEl.textContent = res.emailSent
      ? `Code emailed to ${email}.`
      : "Code generated, but email could not be sent.";
    display.classList.remove("hidden");
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("copyGeneratedCodeBtn").addEventListener("click", async () => {
  const code = document.getElementById("generatedCodeValue").textContent || "";
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    document.getElementById("codeEmailStatus").textContent = "Code copied.";
  } catch {
    document.getElementById("codeEmailStatus").textContent = "Could not copy. Please copy manually.";
  }
});

document.addEventListener("click", async (event) => {
  const { target } = event;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const { editProduct, deleteProduct, deleteWork, deleteReview, deleteDeal, deleteBooking } = target.dataset;

  try {
    if (editProduct) {
      startProductEdit(editProduct);
      return;
    }

    if (deleteProduct) {
      await api(`/api/admin/products/${deleteProduct}`, { method: "DELETE" });
      if (editingProductId === Number(deleteProduct)) {
        resetProductForm();
      }
      await refreshAll();
    }

    if (deleteWork) {
      await api(`/api/admin/works/${deleteWork}`, { method: "DELETE" });
      await refreshAll();
    }

    if (deleteReview) {
      await api(`/api/admin/reviews/${deleteReview}`, { method: "DELETE" });
      await refreshAll();
    }

    if (deleteDeal) {
      await api(`/api/admin/deals/${deleteDeal}`, { method: "DELETE" });
      await refreshAll();
    }

    if (deleteBooking) {
      await api(`/api/admin/bookings/${deleteBooking}`, { method: "DELETE" });
      await refreshAll();
    }
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("bookSubmitBtn").addEventListener("click", async () => {
  const bookStatus = document.getElementById("bookStatus");
  bookStatus.classList.add("hidden");

  const name = document.getElementById("bookName").value.trim();
  const phone = document.getElementById("bookPhone").value.trim();
  const email = document.getElementById("bookEmail").value.trim();
  const service = document.getElementById("bookService").value;
  const booking_date = document.getElementById("bookDate").value;
  const booking_time = document.getElementById("bookTime").value;
  const notes = document.getElementById("bookNotes").value.trim();

  if (!name || !phone || !email || !service || !booking_date || !booking_time) {
    bookStatus.textContent = "Please fill in all required fields.";
    bookStatus.classList.remove("hidden");
    return;
  }

  try {
    await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify({ name, phone, email, service, booking_date, booking_time, notes }),
    });

    document.getElementById("bookName").value = "";
    document.getElementById("bookPhone").value = "";
    document.getElementById("bookEmail").value = "";
    document.getElementById("bookService").value = "";
    document.getElementById("bookDate").value = "";
    document.getElementById("bookTime").value = "";
    document.getElementById("bookNotes").value = "";

    bookStatus.textContent = "Appointment request sent! We will be in touch shortly.";
    bookStatus.style.color = "var(--brand)";
    bookStatus.classList.remove("hidden");

    if (state.token) {
      await refreshAll();
    }
  } catch (err) {
    bookStatus.textContent = `Error: ${err.message}`;
    bookStatus.style.color = "var(--danger)";
    bookStatus.classList.remove("hidden");
  }
});

async function promptDexInstall() {
  if (isStandalone) {
    showDexToast("Dex is already installed on this device.");
    return;
  }

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;

    if (choiceResult?.outcome === "accepted") {
      showDexToast("Installing Dex app...");
    } else {
      showDexToast("Install canceled. You can try again any time.");
    }
    return;
  }

  if (isIos) {
    showDexToast("On iPhone/iPad: tap Share then Add to Home Screen to install Dex.");
    return;
  }

  showDexToast("To install Dex, open browser menu and choose Install App or Add to Home Screen.");
}

document.getElementById("downloadDexDesktopBtn").addEventListener("click", async () => {
  await promptDexInstall();
});

document.getElementById("installDexHeaderBtn").addEventListener("click", async () => {
  await promptDexInstall();
});

document.getElementById("downloadDexIosBtn").addEventListener("click", async () => {
  await promptDexInstall();
});

document.getElementById("downloadDexAndroidBtn").addEventListener("click", async () => {
  await promptDexInstall();
});

function showDexToast(msg) {
  let toast = document.getElementById("dexToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "dexToast";
    toast.className = "dex-toast";
    document.body.appendChild(toast);
  }
  toast.innerHTML = msg;
  toast.classList.add("dex-toast-show");
  setTimeout(() => toast.classList.remove("dex-toast-show"), 3500);
}

// Dex Chat Functions
function openDexChat() {
  state.dexChatOpen = true;
  document.getElementById("dexChatInterface").classList.remove("hidden");
  document.getElementById("dexChatMessages").innerHTML = '';
  state.dexMessages = [];
  
  if (dexVoice.isRecognitionSupported()) {
    startWakeWordListener();
  }
}

function closeDexChat() {
  state.dexChatOpen = false;
  document.getElementById("dexChatInterface").classList.add("hidden");
  dexVoice.stop();
  dexVoice.stopSpeaking();
}

function addChatMessage(text, sender = 'user') {
  state.dexMessages.push({ text, sender });
  const messagesDiv = document.getElementById("dexChatMessages");
  const msgEl = document.createElement("div");
  msgEl.className = `dex-chat-message ${sender}`;
  msgEl.textContent = text;
  messagesDiv.appendChild(msgEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function sendDexMessage(message) {
  if (!message.trim()) return;

  addChatMessage(message, 'user');
  document.getElementById("dexChatInput").value = '';

  try {
    const data = await userApi('/api/dex/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    addChatMessage(data.reply, 'assistant');
    
    // Read response aloud if supported
    if (dexVoice.canSpeak()) {
      dexVoice.speak(data.reply);
    }
  } catch (error) {
    console.error('Dex chat error:', error);
    addChatMessage('Error connecting to Dex. Please try again.', 'assistant');
  }
}

function startWakeWordListener() {
  if (!dexVoice.isRecognitionSupported()) {
    showDexToast('Voice recognition not supported in your browser');
    return;
  }

  dexVoice.on('onWakeWordDetected', () => {
    showDexToast('Hey Dex! 🎤 Say your command now...');
    dexVoice.startUserInput();
  });

  dexVoice.on('onTranscript', (transcript) => {
    if (transcript && transcript.trim()) {
      sendDexMessage(transcript);
      startWakeWordListener(); // Resume listening for next command
    }
  });

  dexVoice.on('onStatusChange', (status) => {
    const statusEl = document.getElementById("dexVoiceStatus");
    if (statusEl) {
      statusEl.textContent = status;
    }
  });

  dexVoice.startWakeWordListener();
}

// ── Dex user auth ─────────────────────────────────────────────────
document.getElementById("dexTabLogin").addEventListener("click", () => {
  document.getElementById("dexLoginForm").classList.remove("hidden");
  document.getElementById("dexRegisterForm").classList.add("hidden");
  document.getElementById("dexCodeForm").classList.add("hidden");
  document.getElementById("dexTabLogin").classList.add("active");
  document.getElementById("dexTabRegister").classList.remove("active");
  document.getElementById("dexTabCode").classList.remove("active");
  document.getElementById("dexAuthStatus").textContent = "";
});

document.getElementById("dexTabRegister").addEventListener("click", () => {
  document.getElementById("dexRegisterForm").classList.remove("hidden");
  document.getElementById("dexLoginForm").classList.add("hidden");
  document.getElementById("dexCodeForm").classList.add("hidden");
  document.getElementById("dexTabRegister").classList.add("active");
  document.getElementById("dexTabLogin").classList.remove("active");
  document.getElementById("dexTabCode").classList.remove("active");
  document.getElementById("dexAuthStatus").textContent = "";
});

document.getElementById("dexTabCode").addEventListener("click", () => {
  document.getElementById("dexCodeForm").classList.remove("hidden");
  document.getElementById("dexLoginForm").classList.add("hidden");
  document.getElementById("dexRegisterForm").classList.add("hidden");
  document.getElementById("dexTabCode").classList.add("active");
  document.getElementById("dexTabLogin").classList.remove("active");
  document.getElementById("dexTabRegister").classList.remove("active");
  document.getElementById("dexAuthStatus").textContent = "";
});

document.getElementById("dexRedeemCodeBtn").addEventListener("click", async () => {
  const code = document.getElementById("dexCodeInput").value.trim().toUpperCase();
  const statusEl = document.getElementById("dexAuthStatus");

  if (!code) {
    statusEl.textContent = "Please enter your one-time access code.";
    statusEl.style.color = "var(--danger)";
    return;
  }

  try {
    statusEl.textContent = "Signing you in with code...";
    statusEl.style.color = "var(--ink-soft)";

    const res = await fetch(apiUrl("/api/auth/user/login-with-code"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Code sign-in failed");

    state.userToken = data.token;
    sessionStorage.setItem("konvict_user_token", data.token);
    await restoreUser();
    setDexUi();
    document.getElementById("dexCodeInput").value = "";
    statusEl.textContent = "";
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = "var(--danger)";
  }
});

document.getElementById("dexLoginBtn").addEventListener("click", async () => {
  const email = document.getElementById("dexLoginEmail").value.trim();
  const password = document.getElementById("dexLoginPassword").value;
  const statusEl = document.getElementById("dexAuthStatus");

  if (!email || !password) {
    statusEl.textContent = "Please fill in all fields.";
    statusEl.style.color = "var(--danger)";
    return;
  }

  try {
    statusEl.textContent = "Signing in…";
    statusEl.style.color = "var(--ink-soft)";
    const res = await fetch(apiUrl("/api/auth/user/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Login failed");

    state.userToken = data.token;
    sessionStorage.setItem("konvict_user_token", data.token);
    await restoreUser();
    setDexUi();
    document.getElementById("dexLoginPassword").value = "";
    statusEl.textContent = "";
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = "var(--danger)";
  }
});

document.getElementById("dexRegisterBtn").addEventListener("click", async () => {
  const username = document.getElementById("dexRegUsername").value.trim();
  const email = document.getElementById("dexRegEmail").value.trim();
  const password = document.getElementById("dexRegPassword").value;
  const ref = new URLSearchParams(window.location.search).get("ref");
  const statusEl = document.getElementById("dexAuthStatus");

  if (!username || !email || !password) {
    statusEl.textContent = "Please fill in all fields.";
    statusEl.style.color = "var(--danger)";
    return;
  }

  if (password.length < 8) {
    statusEl.textContent = "Password must be at least 8 characters.";
    statusEl.style.color = "var(--danger)";
    return;
  }

  try {
    statusEl.textContent = "Creating account…";
    statusEl.style.color = "var(--ink-soft)";
    const res = await fetch(apiUrl("/api/auth/user/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, ref }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Registration failed");

    state.userToken = data.token;
    sessionStorage.setItem("konvict_user_token", data.token);
    await restoreUser();
    setDexUi();
    document.getElementById("dexRegPassword").value = "";
    statusEl.textContent = "";
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = "var(--danger)";
  }
});

document.getElementById("dexLogoutBtn").addEventListener("click", () => {
  state.userToken = "";
  state.user = null;
  sessionStorage.removeItem("konvict_user_token");
  document.getElementById("dexMyBookings").classList.add("hidden");
  stopDexStatsAutoRefresh();
  hideDexCopyStatus();
  closeDexChat();
  setDexUi();
});

document.getElementById("dexChatBtn").addEventListener("click", () => {
  openDexChat();
});

document.getElementById("dexChatClose").addEventListener("click", () => {
  closeDexChat();
});

document.getElementById("dexChatSend").addEventListener("click", () => {
  const input = document.getElementById("dexChatInput");
  sendDexMessage(input.value);
});

document.getElementById("dexChatInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    const input = document.getElementById("dexChatInput");
    sendDexMessage(input.value);
  }
});

document.getElementById("dexVoiceToggle").addEventListener("click", () => {
  if (dexVoice.isListening) {
    dexVoice.stop();
    document.getElementById("dexVoiceToggle").classList.remove("active");
  } else {
    dexVoice.startUserInput();
    document.getElementById("dexVoiceToggle").classList.add("active");
    
    dexVoice.on('onTranscript', (transcript) => {
      if (transcript && transcript.trim()) {
        sendDexMessage(transcript);
      }
      document.getElementById("dexVoiceToggle").classList.remove("active");
    });
  }
});

document.getElementById("dexMyBookingsBtn").addEventListener("click", async () => {
  const panel = document.getElementById("dexMyBookings");
  if (!panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
    return;
  }

  try {
    const bookings = await userApi("/api/user/bookings");
    const list = document.getElementById("dexBookingsList");
    list.innerHTML = bookings.length
      ? bookings.map(userBookingCard).join("")
      : "<p class='meta'>No bookings on file yet.</p>";
    panel.classList.remove("hidden");
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("dexCopyReferralBtn").addEventListener("click", async () => {
  const linkInput = document.getElementById("dexReferralLink");
  const copyStatus = document.getElementById("dexCopyStatus");
  if (!linkInput.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(linkInput.value);
    copyStatus.textContent = "Copied";
  } catch {
    linkInput.select();
    document.execCommand("copy");
    copyStatus.textContent = "Copied";
  }

  copyStatus.classList.remove("hidden");
  if (dexCopyStatusTimeoutId) {
    clearTimeout(dexCopyStatusTimeoutId);
  }
  dexCopyStatusTimeoutId = setTimeout(() => {
    hideDexCopyStatus();
  }, 1600);
});

document.getElementById("dexRefreshStatsBtn").addEventListener("click", async () => {
  await updateReferralCard();
});

// ── Shopping Cart & Checkout ───────────────────────────────────────
document.addEventListener("click", async (event) => {
  const btn = event.target;
  if (!(btn instanceof HTMLElement)) {
    return;
  }
  const { addToCart } = btn.dataset;
  
  if (!addToCart) return;

  const productId = Number(addToCart);
  const productName = btn.dataset.productName;
  const productPrice = Number(btn.dataset.productPrice);
  const productInventory = Number(btn.dataset.productInventory);

  const quantity = prompt(`How many "${productName}" would you like? (Max: ${productInventory})`, "1");
  if (!quantity) return;

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 1 || qty > productInventory) {
    alert(`Please enter a valid quantity between 1 and ${productInventory}`);
    return;
  }

  state.cart.push({ productId, productName, productPrice, quantity: qty, total: productPrice * qty });
  alert(`Added ${qty}x "${productName}" to cart. Total: $${(productPrice * qty).toFixed(2)}`);
  renderCart();
});

function renderCart() {
  const cartDiv = document.getElementById("cartSummary");
  if (!cartDiv) return;

  if (!state.cart.length) {
    cartDiv.innerHTML = "";
    return;
  }

  const cartHTML = `
    <div class="card">
      <h3>Shopping Cart</h3>
      ${state.cart.map((item, idx) => `
        <div class="cart-item">
          <p>${item.quantity}x ${item.productName} = $${item.total.toFixed(2)} <button data-remove-cart="${idx}" class="small danger">Remove</button></p>
        </div>
      `).join("")}
      <p><strong>Total: $${state.cart.reduce((sum, item) => sum + item.total, 0).toFixed(2)}</strong></p>
      <button id="checkoutBtn" class="primary">Proceed to Checkout</button>
      <button id="clearCartBtn" class="secondary">Clear Cart</button>
    </div>
  `;

  cartDiv.innerHTML = cartHTML;

  document.getElementById("checkoutBtn").addEventListener("click", processCheckout);
  document.getElementById("clearCartBtn").addEventListener("click", () => {
    state.cart = [];
    renderCart();
  });

  document.querySelectorAll("[data-remove-cart]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.removeCart);
      state.cart.splice(idx, 1);
      renderCart();
    });
  });
}

async function processCheckout() {
  if (!state.cart.length) {
    alert("Your cart is empty");
    return;
  }

  // For now, show a simple checkout message
  // In production, integrate with Square's web payments SDK
  const totalAmount = state.cart.reduce((sum, item) => sum + item.total, 0).toFixed(2);
  alert(`Checkout feature coming soon! Total: $${totalAmount}`);
  // TODO: Integrate Square Payment Form
}

async function restoreUser() {
  if (!state.userToken) return;
  try {
    state.user = await userApi("/api/user/me");
  } catch {
    state.userToken = "";
    state.user = null;
    sessionStorage.removeItem("konvict_user_token");
  }
}

async function init() {
  await refreshAll();
  await restoreUser();
  updateInstallButtonState();
  setDexUi();
}

init().catch((err) => {
  console.error("Initial data load failed:", err);
  state.products = [];
  state.reviews = [];
  state.works = [];
  state.deals = [];
  state.bookings = [];
  render();
  setDexUi();
  showDexToast("Some online features are temporarily unavailable.");
});
