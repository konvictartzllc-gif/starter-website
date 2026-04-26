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
  me: () => request("/auth/me"),

  // Dex
  chat: (message) => request("/dex/chat", { method: "POST", body: JSON.stringify({ message }) }),
  getDexAccess: () => request("/dex/access"),
  getHistory: () => request("/dex/history"),
  saveAppointment: (body) => request("/dex/appointment", { method: "POST", body: JSON.stringify(body) }),
  getAppointments: () => request("/dex/appointments"),
  getLearningHistory: () => request("/dex/learning/history"),
  getDailyLesson: (body = {}) => request("/dex/learning/daily-lesson", { method: "POST", body: JSON.stringify(body) }),
  createLearningQuiz: (body = {}) => request("/dex/learning/quiz", { method: "POST", body: JSON.stringify(body) }),
  submitLearningQuiz: (body) => request("/dex/learning/quiz/submit", { method: "POST", body: JSON.stringify(body) }),
  getBriefing: () => request("/dex/briefing"),
  getFollowUps: () => request("/dex/follow-ups"),
  getTasks: () => request("/dex/tasks"),
  createTask: (body) => request("/dex/tasks", { method: "POST", body: JSON.stringify(body) }),
  updateTask: (id, body) => request(`/dex/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteTask: (id) => request(`/dex/tasks/${id}`, { method: "DELETE" }),
  getRelationshipAliases: () => request("/dex/relationship-aliases"),
  saveRelationshipAlias: (body) => request("/dex/relationship-aliases", { method: "POST", body: JSON.stringify(body) }),
  deleteRelationshipAlias: (id) => request(`/dex/relationship-aliases/${id}`, { method: "DELETE" }),
  getCommunications: () => request("/dex/communications"),
  createCommunicationDraft: (body) => request("/dex/communications", { method: "POST", body: JSON.stringify(body) }),
  updateCommunicationDraft: (id, body) => request(`/dex/communications/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

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
  createCheckoutSession: () => request("/payments/checkout-session", { method: "POST", body: JSON.stringify({}) }),
  subscribe: () => request("/payments/checkout-session", { method: "POST", body: JSON.stringify({}) }),
  openBillingPortal: () => request("/payments/portal", { method: "POST", body: JSON.stringify({}) }),
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
  updateUserAccess: (id, body) => request(`/admin/users/${id}/access`, { method: "PATCH", body: JSON.stringify(body) }),
  sendPromo: (body) => request("/admin/send-promo", { method: "POST", body: JSON.stringify(body) }),
  getUsers: () => request("/admin/users"),
  getFeatureFlags: () => request("/admin/feature-flags"),
  updateFeatureFlag: (key, body) => request(`/admin/feature-flags/${key}`, { method: "PATCH", body: JSON.stringify(body) }),
};
