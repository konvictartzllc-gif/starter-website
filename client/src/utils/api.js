// ...existing code...
const BASE = import.meta.env.VITE_API_URL || "/api";

function getToken() {
  return localStorage.getItem("dex_token");
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

export const api = {
  // Auth
  register: (body) => request("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body) => request("/auth/login", { method: "POST", body: JSON.stringify(body) }),

  // Dex
  chat: (message) => request("/dex/chat", { method: "POST", body: JSON.stringify({ message }) }),
  getDexAccess: () => request("/dex/access"),
  getHistory: () => request("/dex/history"),
  saveAppointment: (body) => request("/dex/appointment", { method: "POST", body: JSON.stringify(body) }),
  getAppointments: () => request("/dex/appointments"),

  // Learned Preferences
  getPreferences: () => request("/dex/preferences"),
  setPreference: (key, value) => request("/dex/preferences", { method: "POST", body: JSON.stringify({ key, value }) }),

  // Call Events
  getCallEvents: () => request("/dex/call-events"),

  // Permissions
  getPermissions: () => request("/dex/permissions"),
  setPermissions: (permissions) => request("/dex/permissions", { method: "POST", body: JSON.stringify({ permissions }) }),

  // User Memory
  getMemory: () => request("/dex/memory"),
  setMemory: (key, value) => request("/dex/memory", { method: "POST", body: JSON.stringify({ key, value }) }),

  // Payments
  subscribe: (sourceId) => request("/payments/subscribe", { method: "POST", body: JSON.stringify({ sourceId }) }),
  getPaymentStatus: () => request("/payments/status"),

  // Affiliate
  getAffiliateDashboard: () => request("/affiliate/dashboard"),

  // Admin
  getAdminStats: () => request("/admin/stats"),
  getInventory: () => request("/admin/inventory"),
  addInventory: (body) => request("/admin/inventory", { method: "POST", body: JSON.stringify(body) }),
  updateInventory: (id, body) => request(`/admin/inventory/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteInventory: (id) => request(`/admin/inventory/${id}`, { method: "DELETE" }),
  getAffiliates: () => request("/admin/affiliates"),
  createAffiliate: (body) => request("/admin/affiliates/create", { method: "POST", body: JSON.stringify(body) }),
  sendPromo: (body) => request("/admin/send-promo", { method: "POST", body: JSON.stringify(body) }),
  getUsers: () => request("/admin/users"),
};
