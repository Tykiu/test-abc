class ApiClient {
  constructor() {
    const defaultApi = "https://uit-test.onrender.com";
    const savedApi = localStorage.getItem("sb_api_base");
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    this.baseUrl = savedApi || (isLocal ? "http://localhost:8000" : defaultApi);
    this.isAvailable = false;
  }

  async fetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");
    
    const token = sessionManager.getToken();
    if (!headers.has("Authorization") && token) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text }; }
    
    if (!response.ok) throw new Error(data.detail || data.message || "Yêu cầu thất bại");
    return data;
  }

  async checkHealth() {
    try { await this.fetch("/api/health"); this.isAvailable = true; }
    catch { this.isAvailable = false; }
    apiAvailable = this.isAvailable;
  }
}

class SessionManager {
  getToken() { return localStorage.getItem("sb_access_token") || ""; }
  setToken(token) { token ? localStorage.setItem("sb_access_token", token) : localStorage.removeItem("sb_access_token"); }
  
  persist(user, profile) {
    if (user && profile) localStorage.setItem("sb_session", JSON.stringify({ user, profile }));
    else localStorage.removeItem("sb_session");
  }
  
  restore() {
    const raw = localStorage.getItem("sb_session");
    if (!raw) return { user: null, profile: null };
    try { 
      const saved = JSON.parse(raw); 
      return { user: saved.user || null, profile: saved.profile || null }; 
    } catch { 
      localStorage.removeItem("sb_session"); 
      return { user: null, profile: null };
    }
  }
}

class ChatManager {
  constructor() {
    this.pollInterval = null;
    document.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && e.target && e.target.id === "chatInput") {
        e.preventDefault();
        sendMsg();
      }
    });
  }
  startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(async () => {
      if (apiAvailable && sessionManager.getToken() && !DEMO_PREVIEW_MODE && qs("chatPage")?.classList.contains("open")) {
        const activeChatId = currentChatUser?.id;
        const oldMsgCount = currentChatUser?.messages?.length || 0;
        await loadConversations();
        if (activeChatId && currentChatUser && currentChatUser.id === activeChatId) {
          await loadMessagesForChat(currentChatUser);
          if (currentChatUser.messages.length > oldMsgCount) renderChatMessages();
        }
      }
    }, 5000);
  }
  stopPolling() {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
  }
}

const api = new ApiClient();
const sessionManager = new SessionManager();
const chatManager = new ChatManager();

let apiAvailable = false;
let currentUser = null;
let currentProfile = null;
let currentMode = "study";
let allCards = [];
let activeFilters = { year: "", subject: "", method: "", is_verified: "" };
let currentChatUser = null;
let chatCache = [];
let resetRecoveryActive = false;
let modalZIndex = 9999;

const DEMO_PREVIEW_MODE = false; 

function qs(id) {
  return document.getElementById(id);
}

function getToken() { return sessionManager.getToken(); }
function setToken(token) { sessionManager.setToken(token); }

function getDemoData() {
  return window.DEMO_DATA || null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function encodeInline(value) {
  return encodeURIComponent(String(value ?? ""));
}

function decodeInline(value) {
  return decodeURIComponent(String(value ?? ""));
}

function showToast(message, type = "info") {
  const container = qs("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-4px)";
    setTimeout(() => toast.remove(), 220);
  }, 2600);
}

function showAlert(el, message, ok = false) {
  if (!el) return;
  el.textContent = message;
  el.className = `alert ${ok ? "alert-success" : "alert-error"} show`;
}

function clearAlert(el) {
  if (!el) return;
  el.textContent = "";
  el.className = "alert";
}

function setButtonLoading(id, loading, loadingText = "Đang xử lý...") {
  const button = typeof id === "string" ? qs(id) : id;
  if (!button) return;

  if (!button.dataset.originalText) {
    button.dataset.originalText = button.innerHTML;
  }

  if (loading) {
    button.disabled = true;
    button.classList.add("btn-loading");
    button.setAttribute("aria-busy", "true");
    if (loadingText) button.innerHTML = loadingText;
  } else {
    button.disabled = false;
    button.classList.remove("btn-loading");
    button.removeAttribute("aria-busy");
    button.innerHTML = button.dataset.originalText || button.innerHTML;
  }
}

function updateNavBadge() {
  const totalUnread = chatCache.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0);
  const badge = qs("msgBadge");
  if (badge) {
    badge.textContent = totalUnread > 99 ? "99+" : totalUnread;
    badge.style.display = totalUnread > 0 ? "flex" : "none";
  }
}

function readHashParams() {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(hash);
}

function clearRecoveryHash() {
  if (window.location.hash) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

function validateUitEmail(email) {
  return /^[a-zA-Z0-9._%+\-]+@gm\.uit\.edu\.vn$/.test(email);
}

function validatePassword(password) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

function validateMSSV(inputOrValue) {
  const value = typeof inputOrValue === "string" ? inputOrValue : (inputOrValue?.value || "");
  const valid = /^\d{8}$/.test(value);
  qs("regMSSVErr")?.classList.toggle("show", value.length > 0 && !valid);
  return valid;
}

function formatChatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modalZIndex++;
    modal.classList.add("open");
    modal.style.display = "flex"; 
    modal.style.zIndex = modalZIndex;  
  }
}

function closeModal(id) {
  const el = qs(id);
  if (!el) return;
  el.classList.remove("open");
  el.style.display = "";      
  el.style.zIndex = "";       
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach((el) => {
    el.classList.remove("open");
    el.style.display = "";    
    el.style.zIndex = "";    
  });
}

function closeAllPages() {
  qs("chatPage")?.classList.remove("open");
  qs("accountPage")?.classList.remove("open");
  if (typeof chatManager !== "undefined") chatManager.stopPolling();
}

function showHome() {
  closeAllPages();
  closeAllModals();
}

function toggleDropdown(id) {
  qs(id)?.classList.toggle("open");
}

function toggleChipDrop(id) {
  document.querySelectorAll(".chip-dropdown").forEach((el) => {
    if (el.id !== id) el.classList.remove("open");
  });
  qs(id)?.classList.toggle("open");
}

function setFilter(key, value, dropdownId) {
  activeFilters[key] = value;
  const hasAnyFilter = Object.values(activeFilters).some(Boolean);
  if (qs("clearFilter")) qs("clearFilter").style.display = hasAnyFilter ? "inline-flex" : "none";
  if (dropdownId) qs(dropdownId)?.classList.remove("open");
  renderCards();
}

function clearFilters() {
  activeFilters = { year: "", subject: "", method: "", is_verified: "" };
  if (qs("clearFilter")) qs("clearFilter").style.display = "none";
  if (qs("searchInput")) qs("searchInput").value = "";
  renderCards();
}

function uploadAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      reject(new Error("Ảnh quá lớn, vui lòng chọn ảnh nhỏ hơn 5MB"));
      return;
    }

    const img = new Image();
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Không thể đọc file ảnh"));
    reader.onload = (e) => {
      img.src = e.target.result;
    };

    img.onerror = () => reject(new Error("Không thể xử lý ảnh"));
    img.onload = () => {
      const MAX = 200;
      let w = img.width;
      let h = img.height;
      if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
      else        { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(dataUrl);
    };

    reader.readAsDataURL(file);
  });
}

function apiFetch(path, options = {}) { return api.fetch(path, options); }

function checkApiHealth() { return api.checkHealth(); }

function renderAvatar(user) {
  const el = document.getElementById('navAvatar');

  if (user.avatar_url) {
    el.innerHTML = `<img src="${user.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  } else {
    el.innerText = user.name ? user.name[0] : "U";
  }
}

function persistSession() {
  sessionManager.persist(currentUser, currentProfile);
}

function restoreSession() {
  const session = sessionManager.restore();
  currentUser = session.user;
  currentProfile = session.profile;
}

function updateNavbar() {
  const guest = qs("guestBtns");
  const userWrap = qs("userMenuWrap");

  if (!currentUser) {
    if (guest) guest.style.display = "flex";
    if (userWrap) userWrap.style.display = "none";
    return;
  }

  if (guest) guest.style.display = "none";
  if (userWrap) userWrap.style.display = "flex";

  const initials = (currentProfile?.full_name || currentUser.email || "U")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(-2)
    .join("")
    .toUpperCase();

  if (currentProfile?.avatar_url) {
    qs("navAvatar").innerHTML = `<img src="${currentProfile.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  } else {
    qs("navAvatar").textContent = initials || "U";
  }
  qs("navName").textContent = currentProfile?.full_name || currentUser.email || "Người dùng";
  qs("navStatus").textContent = currentProfile?.is_verified ? "Đã xác thực" : "Chưa xác thực";
}

function applyDemoPreview() {
  const demo = getDemoData();
  if (!demo) return;

  currentUser = demo.user || null;
  currentProfile = demo.profile || null;
  allCards = Array.isArray(demo.cards) ? demo.cards.slice() : [];
  chatCache = Array.isArray(demo.conversations) ? demo.conversations.slice() : [];
  persistSession();
  updateNavbar();
  renderCards();
  renderChatList();
}

function getFilteredCards() {
  const query = (qs("searchInput")?.value || "").trim().toLowerCase();
  let cards = allCards.filter((card) => card.type === currentMode);

  if (activeFilters.subject && activeFilters.subject !== "") {
    cards = cards.filter((card) => card.subject === activeFilters.subject);
  }

  if (activeFilters.method && activeFilters.method !== "") {
    cards = cards.filter((card) => card.method === activeFilters.method);
  }

  if (activeFilters.verified === "true" || activeFilters.is_verified === "true" || activeFilters.is_verified === true) {
    cards = cards.filter((card) => (card.profiles?.is_verified === true || card.is_verified === true));
  } else if (activeFilters.verified === "false" || activeFilters.is_verified === "false" || activeFilters.is_verified === false) {
    cards = cards.filter((card) => (card.profiles?.is_verified === false || card.is_verified === false));
  }

  if (activeFilters.year && activeFilters.year !== "") {
    const yearStr = activeFilters.year.toString();
    const yearPrefix = yearStr.length > 2 ? yearStr.slice(-2) : yearStr; 
    cards = cards.filter((card) => {
      const mssv = String(card.profiles?.mssv || card.mssv || "");
      return mssv.startsWith(yearPrefix);
    });
  }

  if (query) {
    cards = cards.filter((card) => {
      const blob = `${card.subject} ${card.note || ""} ${card.profiles?.full_name || ""} ${card.mssv || ""}`.toLowerCase();
      return blob.includes(query);
    });
  }

  return cards;
}

function buildCard(card) {
  const profile = card.profiles || {};
  const isMyCard = currentUser && card.user_id === currentUser.id;
  const avatarUrl = isMyCard
    ? (currentProfile?.avatar_url || profile.avatar_url || null)
    : (profile.avatar_url || null);
  const initials = (profile.full_name || "U").trim().slice(0, 1).toUpperCase();
  
  // Sửa avatarHtml để hỗ trợ CSS Gradient và bọc thẻ Div
  const avatarHtml = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='${escapeHtml(initials)}'">`
    : `<div class="card-avatar-inner">${escapeHtml(initials)}</div>`;

  const verifiedBadge = profile.is_verified
    ? `<span class="chip">Đã xác thực</span>`
    : `<span class="chip">Chưa xác thực</span>`;
  const modeBadge =
    card.method === "online"
      ? `<span class="chip">Online</span>`
      : `<span class="chip">Offline</span>`;
  const tutorBadge =
    card.type === "tutor" && card.tutor_role
      ? `<span class="chip">${card.tutor_role === "offering" ? "Nhận dạy" : "Cần gia sư"}</span>`
      : "";
  const fillPercent = Math.max(
    0,
    Math.min(100, Math.round(((card.current_slots || 0) / Math.max(card.slots || 1, 1)) * 100))
  );

  return `
    <div class="card">
      <div class="card-header">
        <div style="display:flex;gap:12px;align-items:center">
          <div class="card-avatar" style="overflow:hidden;flex-shrink:0">${avatarHtml}</div>
          <div class="card-meta">
            <div class="card-name">${escapeHtml(profile.full_name || "Ẩn danh")}</div>
            <div class="card-mssv">${escapeHtml(profile.mssv || "--------")}</div>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="card-subject">${escapeHtml(card.subject || "")}</div>
        <div class="card-badges" style="margin-top:12px;flex-wrap:wrap">
          ${verifiedBadge}
          ${modeBadge}
          ${tutorBadge}
        </div>
        <div class="card-info" style="margin-top:14px">
          <div class="card-info-row">Thời gian: ${escapeHtml(card.time || "-")}</div>
          <div class="card-info-row">${card.method === "online" ? "Link" : "Địa điểm"}: ${escapeHtml(card.location_or_link || "-")}</div>
          <div class="card-info-row">Số lượng: ${card.current_slots || 0}/${card.slots || 0}</div>
          <div class="slots-bar"><div class="slots-fill" style="width:${fillPercent}%"></div></div>
        </div>
        ${card.note ? `<div class="card-note">${escapeHtml(card.note)}</div>` : ""}
      </div>
      <div class="card-footer" style="margin-top:16px">
        <button class="btn-full secondary" style="width:auto" onclick="openDetail(${card.id})">Xem chi tiết</button>
      </div>
    </div>
  `;
}

function renderCards() {
  const cards = getFilteredCards();
  const emptyHtml =
    `<div class="empty-state"><div class="detail-name">Không tìm thấy kết quả</div><div class="verify-banner-text">Thử đổi bộ lọc hoặc từ khóa tìm kiếm.</div></div>`;

  qs("cardsGrid").innerHTML = cards.length ? cards.map(buildCard).join("") : emptyHtml;
  qs("modeTitle").textContent =
    currentMode === "study"
      ? "Study Buddy - Học nhóm cùng tiến"
      : "Tutor - Kết nối gia sư nội bộ";
  qs("cardCount").textContent = `${cards.length} bài đăng`;
}

function filterCards() {
  renderCards();
}

async function loadCards() {
  if (DEMO_PREVIEW_MODE) {
    const demo = getDemoData();
    allCards = Array.isArray(demo?.cards) ? demo.cards.slice() : [];
    renderCards();
    updateSubjectFilter(allCards);
    return;
  }

  try {
    if (!apiAvailable) {
      throw new Error("Backend không khả dụng");
    }

    const [studyRes, tutorRes] = await Promise.all([
      apiFetch("/api/requests?type=study&limit=50"),
      apiFetch("/api/requests?type=tutor&limit=50"),
    ]);

    allCards = [...(studyRes.data || []), ...(tutorRes.data || [])];
    renderCards();
    updateSubjectFilter(allCards);
  } catch (error) {
    const demo = getDemoData();
    allCards = Array.isArray(demo?.cards) ? demo.cards.slice() : [];
    updateSubjectFilter(allCards);
    renderCards();
    showToast(error.message || "Không tải được dữ liệu backend", "error");
  }
}

function switchMode(mode) {
  currentMode = mode;
  qs("modeStudy")?.classList.toggle("active", mode === "study");
  qs("modeTutor")?.classList.toggle("active", mode === "tutor");
  renderCards();
}

function loginSuccess(user, profile, token, refreshToken = "") {
  currentUser = user || null;
  currentProfile = profile || null;
  setToken(token || "");
  if (refreshToken) {
    localStorage.setItem("sb_refresh_token", refreshToken);
  }
  persistSession();
  updateNavbar();
  void loadConversations();
}

function logout() {
  currentUser = null;
  currentProfile = null;
  currentChatUser = null;
  chatCache = [];
  setToken("");
  localStorage.removeItem("sb_refresh_token");
  persistSession();
  updateNavbar();
  closeAllPages();
  closeAllModals();
  renderChatList();
  chatManager.stopPolling();
  showToast("Đã đăng xuất");
}

async function doLogin() {
  const email = qs("loginEmail").value.trim();
  const password = qs("loginPassword").value;
  const errorEl = qs("loginError");
  clearAlert(errorEl);

  if (!email || !password) {
    showAlert(errorEl, "Vui lòng nhập đầy đủ thông tin");
    return;
  }
  if (!validateUitEmail(email)) {
    showAlert(errorEl, "Email phải có đuôi @gm.uit.edu.vn");
    return;
  }

  try {
    setButtonLoading("loginBtn", true, "Đang đăng nhập...");
    if (!apiAvailable) {
      throw new Error("Backend chưa chạy nên không thể đăng nhập");
    }

    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    loginSuccess(
      res.user || { email },
      res.profile || {},
      res.access_token || "",
      res.refresh_token || ""
    );
    closeModal("loginModal");
    showToast("Đăng nhập thành công", "success");
    renderCards();
  } catch (error) {
    showAlert(errorEl, error.message || "Đăng nhập thất bại");
  } finally {
    setButtonLoading("loginBtn", false);
  }
}

async function forgotPassword() {
  const errorEl = qs("loginError");
  const email = (qs("loginEmail")?.value || "").trim();
  clearAlert(errorEl);

  if (!email) {
    showAlert(errorEl, "Nhập email UIT trước khi đặt lại mật khẩu");
    return;
  }
  if (!validateUitEmail(email)) {
    showAlert(errorEl, "Email phải có đuôi @gm.uit.edu.vn");
    return;
  }

  try {
    setButtonLoading("loginBtn", true, "Đang gửi OTP...");
    if (!apiAvailable) {
      throw new Error("Backend chưa chạy nên không thể gửi OTP đặt lại mật khẩu");
    }

    const res = await apiFetch("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    closeModal("loginModal");
    qs("forgotOtpEmailDisplay").textContent = email;
    qs("forgotOtpInput").value = "";
    clearAlert(qs("forgotOtpError"));
    openModal("forgotOtpModal");
    showToast(res.message || "Đã gửi OTP đặt lại mật khẩu", "success");
  } catch (error) {
    showAlert(errorEl, error.message || "Không thể gửi OTP đặt lại mật khẩu");
  } finally {
    setButtonLoading("loginBtn", false);
  }
}

async function verifyForgotOtp() {
  const errorEl = qs("forgotOtpError");
  const email = (qs("loginEmail")?.value || "").trim();
  const token = (qs("forgotOtpInput")?.value || "").trim();
  clearAlert(errorEl);

  if (!token || token.length !== 6) {
    showAlert(errorEl, "Vui lòng nhập đủ 6 số OTP.");
    return;
  }

  try {
    setButtonLoading("verifyForgotOtpBtn", true, "Đang xác thực...");
    if (!apiAvailable) {
      throw new Error("Backend chưa chạy nên không thể xác thực OTP");
    }

    const res = await apiFetch("/api/auth/verify-reset-otp", {
      method: "POST",
      body: JSON.stringify({ email, token }),
    });

    if (res.success && res.access_token) {
      closeModal("forgotOtpModal");
      setToken(res.access_token);
      if (res.refresh_token) {
        localStorage.setItem("sb_refresh_token", res.refresh_token);
      }
      resetRecoveryActive = true;
      qs("resetPasswordNew").value = "";
      qs("resetPasswordConfirm").value = "";
      clearAlert(qs("resetPasswordError"));
      clearAlert(qs("resetPasswordSuccess"));
      openModal("resetPasswordModal");
      showToast(res.message || "Xác thực OTP thành công", "success");
    } else {
      throw new Error("Mã OTP không hợp lệ.");
    }
  } catch (error) {
    showAlert(errorEl, error.message || "Mã OTP không đúng hoặc đã hết hạn.");
  } finally {
    setButtonLoading("verifyForgotOtpBtn", false);
  }
}

function checkRecoveryFlow() {
  const hashParams = readHashParams();
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  const type = hashParams.get("type");

  if (!accessToken || type !== "recovery") return;

  resetRecoveryActive = true;
  setToken(accessToken);
  if (refreshToken) {
    localStorage.setItem("sb_refresh_token", refreshToken);
  }
  clearRecoveryHash();
  clearAlert(qs("resetPasswordError"));
  clearAlert(qs("resetPasswordSuccess"));
  qs("resetPasswordNew").value = "";
  qs("resetPasswordConfirm").value = "";
  openModal("resetPasswordModal");
}

async function submitResetPassword() {
  const password = qs("resetPasswordNew")?.value || "";
  const confirm = qs("resetPasswordConfirm")?.value || "";
  const errorEl = qs("resetPasswordError");
  const successEl = qs("resetPasswordSuccess");
  clearAlert(errorEl);
  clearAlert(successEl);

  if (!resetRecoveryActive || !getToken()) {
    showAlert(errorEl, "Phiên đặt lại mật khẩu không hợp lệ. Vui lòng thử lại từ email.");
    return;
  }
  if (!validatePassword(password)) {
    showAlert(errorEl, "Mật khẩu phải từ 8 ký tự, gồm chữ và số.");
    return;
  }
  if (password !== confirm) {
    showAlert(errorEl, "Mật khẩu xác nhận không khớp.");
    return;
  }

  try {
    setButtonLoading("resetPasswordBtn", true, "Đang cập nhật...");
    const res = await apiFetch("/api/auth/update-password", {
      method: "POST",
      body: JSON.stringify({
        password,
        password_confirm: confirm,
      }),
    });

    resetRecoveryActive = false;
    setToken("");
    localStorage.removeItem("sb_refresh_token");
    showAlert(successEl, res.message || "Đặt lại mật khẩu thành công.", true);
    setTimeout(() => {
      closeModal("resetPasswordModal");
      openModal("loginModal");
    }, 1200);
  } catch (error) {
    showAlert(errorEl, error.message || "Không thể cập nhật mật khẩu mới.");
  } finally {
    setButtonLoading("resetPasswordBtn", false);
  }
}

async function doRegister() {
  const fullName = qs("regName").value.trim();
  const email = qs("regEmail").value.trim();
  const mssv = qs("regMSSV").value.trim();
  const password = qs("regPass").value;
  const confirm = qs("regPassConfirm").value;
  const errorEl = qs("regError");
  clearAlert(errorEl);

  if (!fullName || !email || !mssv || !password || !confirm) {
    showAlert(errorEl, "Vui lòng nhập đầy đủ thông tin");
    return;
  }
  if (!validateUitEmail(email)) {
    showAlert(errorEl, "Email không hợp lệ");
    return;
  }
  if (!validateMSSV(mssv)) {
    showAlert(errorEl, "MSSV phải đúng 8 chữ số");
    return;
  }
  if (!validatePassword(password)) {
    showAlert(errorEl, "Mật khẩu phải từ 8 ký tự, gồm chữ và số");
    return;
  }
  if (password !== confirm) {
    showAlert(errorEl, "Mật khẩu xác nhận không khớp");
    return;
  }

  try {
    setButtonLoading("regBtn", true, "Đang tạo tài khoản...");
    if (!apiAvailable) {
      throw new Error("Backend chưa chạy nên không thể đăng ký");
    }

    await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        full_name: fullName,
        email,
        mssv,
        password,
        password_confirm: confirm,
      }),
    });

    const loginRes = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    loginSuccess(
      loginRes.user || { email },
      loginRes.profile || {},
      loginRes.access_token || "",
      loginRes.refresh_token || ""
    );
    closeModal("registerModal");
    showToast("Tạo tài khoản thành công", "success");
  } catch (error) {
    showAlert(errorEl, error.message || "Đăng ký thất bại");
  } finally {
    setButtonLoading("regBtn", false);
  }
}

function toggleLocationField() {
  const method = qs("postMethod").value;
  qs("linkField").style.display = method === "online" ? "block" : "none";
  qs("locationField").style.display = method === "offline" ? "block" : "none";
}

function openPostModal() {
  if (!currentUser) {
    openModal("loginModal");
    return;
  }

  historyManager.resetPostModal();
  qs("postModalTitle").textContent =
    currentMode === "study" ? "Tạo yêu cầu Study Buddy" : "Tạo yêu cầu Tutor";
  qs("postName").value = currentProfile?.full_name || "";
  qs("postMSSV").value = currentProfile?.mssv || "";
  qs("postSubject").value = "";
  qs("postTime").value = "";
  qs("postLink").value = "";
  qs("postLocation").value = "";
  qs("postNote").value = "";
  qs("postSlots").value = "4";
  qs("postMethod").value = "online";
  qs("postTutorRole").value = "seeking";
  qs("unverifiedPostWarn").style.display = currentProfile?.is_verified ? "none" : "flex";
  qs("tutorRoleField").style.display = currentMode === "tutor" ? "block" : "none";
  toggleLocationField();
  openModal("postModal");
}

async function doPost() {
  const subject = qs("postSubject").value.trim();
  const method = qs("postMethod").value;
  const time = qs("postTime").value.trim();
  const slots = Number(qs("postSlots").value || 4);
  const note = qs("postNote").value.trim();
  const locationOrLink =
    method === "online" ? qs("postLink").value.trim() : qs("postLocation").value.trim();
  const tutorRole = currentMode === "tutor" ? qs("postTutorRole").value : null;

  if (!subject || !time || !locationOrLink) {
    showToast("Vui lòng nhập đủ thông tin bài đăng", "error");
    return;
  }

  try {
    setButtonLoading("postBtn", true, "Đang đăng bài...");
    if (!apiAvailable || !getToken()) {
      throw new Error("Backend chưa chạy nên không thể tạo bài");
    }

    await apiFetch("/api/requests", {
      method: "POST",
      body: JSON.stringify({
        type: currentMode,
        subject,
        method,
        location_or_link: locationOrLink,
        time,
        slots,
        note,
        tutor_role: tutorRole,
      }),
    });

    await loadCards();
    closeModal("postModal");
    showToast("Đăng bài thành công", "success");
  } catch (error) {
    showToast(error.message || "Không thể tạo bài đăng", "error");
  } finally {
    setButtonLoading("postBtn", false);
  }
}

function findCard(id) {
  return allCards.find((card) => Number(card.id) === Number(id));
}

function openDetail(id) {
  const card = findCard(id);
  if (!card) return;

  const profile = card.profiles || {};
  const verifiedLabel = profile.is_verified ? "Đã xác thực" : "Chưa xác thực";

  qs("detailBody").innerHTML = `
    <div class="detail-header-wrap">
      <div class="detail-avatar-row">
        <div class="detail-avatar">${escapeHtml((profile.full_name || "U").slice(0, 1).toUpperCase())}</div>
        <div>
          <div class="detail-name">${escapeHtml(profile.full_name || "Ẩn danh")}</div>
          <div class="detail-mssv">MSSV: ${escapeHtml(profile.mssv || "--------")} - ${verifiedLabel}</div>
        </div>
      </div>
    </div>
    <div class="detail-info-grid">
      <div class="detail-info-item"><div class="detail-info-label">Môn học</div><div class="detail-info-value">${escapeHtml(card.subject || "-")}</div></div>
      <div class="detail-info-item"><div class="detail-info-label">Thời gian</div><div class="detail-info-value">${escapeHtml(card.time || "-")}</div></div>
      <div class="detail-info-item"><div class="detail-info-label">Hình thức</div><div class="detail-info-value">${card.method === "online" ? "Online" : "Offline"}</div></div>
      <div class="detail-info-item"><div class="detail-info-label">${card.method === "online" ? "Link họp" : "Địa điểm"}</div><div class="detail-info-value">${escapeHtml(card.location_or_link || "-")}</div></div>
      <div class="detail-info-item"><div class="detail-info-label">Số lượng</div><div class="detail-info-value">${card.current_slots || 0}/${card.slots || 0}</div></div>
    </div>
    ${card.note ? `<div class="detail-note">${escapeHtml(card.note)}</div>` : ""}
  `;

  const profileAvatarUrl = profile.avatar_url || "";
  qs("detailFooter").innerHTML = !currentUser
    ? `<button class="btn-full secondary" onclick="closeModal('detailModal')">Đóng</button><button class="btn-full" onclick="closeModal('detailModal');openModal('loginModal')">Đăng nhập để tham gia</button>`
    : `<button class="btn-full secondary" onclick="closeModal('detailModal')">Đóng</button><button class="btn-full secondary" onclick="startChatWith('${encodeInline(card.user_id || "")}', '${encodeInline(profile.full_name || "Người dùng")}', '${encodeInline(profile.mssv || "")}', '${encodeInline(profileAvatarUrl)}')">Chat</button><button class="btn-full" id="detailJoinBtn" onclick="joinRequest(${card.id})">Tham gia</button>`;

  openModal("detailModal");
}

async function joinRequest(id) {
  try {
    setButtonLoading("detailJoinBtn", true, "Đang tham gia...");
    if (!apiAvailable || !getToken()) {
      throw new Error("Backend chưa chạy nên không thể tham gia");
    }

    await apiFetch(`/api/requests/${id}/join`, { method: "POST" });
    await loadCards();
    closeModal("detailModal");
    showToast("Tham gia thành công", "success");
  } catch (error) {
    showToast(error.message || "Không thể tham gia", "error");
  } finally {
    setButtonLoading("detailJoinBtn", false);
  }
}

function renderChatList() {
  const container = qs("chatList");
  if (!container) return;

  container.innerHTML = chatCache.length
    ? chatCache
        .map(
          (chat) => {
            const initial = (chat.name || "U").trim().slice(0, 1).toUpperCase();
            let lastMsgHtml = '';
            if (chat.draft) {
              lastMsgHtml = `<span style="color: var(--danger); font-weight: 600;">[Nháp] ${escapeHtml(chat.draft)}</span>`;
            } else if (chat.last) {
              const isUnread = chat.unreadCount > 0;
              const fw = isUnread ? 'font-weight: 800; color: var(--text);' : 'color: var(--text-muted);';
              lastMsgHtml = `<span style="${fw}">${escapeHtml(chat.last)}</span>`;
            } else {
              lastMsgHtml = `<span style="font-style:italic;opacity:0.7;color:var(--text-muted);">Chưa có tin nhắn</span>`;
            }

            const unreadBadge = chat.unreadCount > 0 
              ? `<div style="background: var(--danger, #ff4d4f); color: #fff; font-size: 0.75rem; font-weight: bold; border-radius: 6px; min-width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; padding: 0 6px; margin-left: 8px; flex-shrink: 0; box-shadow: 0 2px 4px rgba(255,77,79,0.2);">${chat.unreadCount}</div>` 
              : '';

            const isActive = currentChatUser && currentChatUser.id === chat.id;
            const avatarContent = chat.avatarUrl
              ? `<img src="${escapeHtml(chat.avatarUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='${escapeHtml(initial)}'">`
              : escapeHtml(initial);
            
            const bgStyle = chat.unreadCount > 0 && !isActive ? 'background: rgba(0, 132, 255, 0.05); border-radius: 8px;' : '';
            const timeStr = chat.lastTime ? formatChatTime(chat.lastTime) : '';
            const timeHtml = timeStr ? `<span style="font-size: 0.75rem; margin-left: 8px; flex-shrink: 0; ${chat.unreadCount > 0 ? 'font-weight: 600; color: var(--primary, #0084ff);' : 'color: var(--text-muted);'}">${timeStr}</span>` : '';

            return `
              <div class="chat-item-card${isActive ? ' active' : ''}" style="${bgStyle}" onclick="openChatWith('${encodeInline(chat.id)}','${encodeInline(chat.name)}','${encodeInline(chat.mssv || '')}','${encodeInline(chat.avatarUrl || '')}')">
                <div class="chat-item-avatar-wrap">${avatarContent}</div>
                <div class="chat-item-info">
                  <div class="chat-item-name" style="${chat.unreadCount > 0 ? 'font-weight: 800; color: var(--text);' : 'font-weight: 600; color: var(--c1);'} display: flex; justify-content: space-between; align-items: center;">
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(chat.name || 'Người dùng')}</span>
                    ${timeHtml}
                  </div>
                  <div class="chat-item-last" style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${lastMsgHtml}</span>
                    ${unreadBadge}
                  </div>
                </div>
              </div>
            `;
          }
        )
        .join("")
    : `<div class="empty-state"><div class="detail-name">Chưa có tin nhắn</div><div class="verify-banner-text">Các cuộc trò chuyện sẽ hiện ở đây khi bạn bắt đầu chat.</div></div>`;
}

async function loadConversations() {
  if (DEMO_PREVIEW_MODE) {
    const demo = getDemoData();
    chatCache = Array.isArray(demo?.conversations) ? demo.conversations.slice() : [];
    renderChatList();
    return;
  }

  if (!apiAvailable || !getToken()) {
    chatCache = [];
    renderChatList();
    return;
  }

  try {
    const res = await apiFetch("/api/messages?limit=50");
    const newData = (res.data || []).map((item) => {
      const existing = chatCache.find((c) => c.id === String(item.user_id));
      const isActive = currentChatUser && currentChatUser.id === String(item.user_id);
      
      if (isActive && item.unread_count > 0) {
        apiFetch(`/api/messages/${encodeURIComponent(item.user_id)}/read`, { method: "POST" }).catch(console.error);
      }

      return {
        id: String(item.user_id),
        name: item.full_name || "Người dùng",
        mssv: item.mssv || "",
        avatarUrl: item.avatar_url || "",
        last: item.last_message || "",
        lastTime: item.last_time || "",
        unreadCount: isActive ? 0 : (item.unread_count || 0),
        messages: existing ? existing.messages : [],
        loaded: existing ? existing.loaded : false,
        draft: existing ? existing.draft : "",
      };
    });
    chatCache = newData;
    chatCache.sort((a, b) => {
      const timeA = a.lastTime ? new Date(a.lastTime).getTime() : 0;
      const timeB = b.lastTime ? new Date(b.lastTime).getTime() : 0;
      return timeB - timeA; 
    });
    renderChatList();
    updateNavBadge();
  } catch (error) {
    showToast(error.message || "Không tải được danh sách hội thoại", "error");
  }
}

function upsertChat(chat) {
  const normalized = {
    id: String(chat.id || ""),
    name: chat.name || "Người dùng",
    mssv: chat.mssv || "",
    avatarUrl: chat.avatarUrl || "",
    last: chat.last || "",
    lastTime: chat.lastTime || "",
    unreadCount: chat.unreadCount || 0,
    messages: Array.isArray(chat.messages) ? chat.messages : [],
    loaded: !!chat.loaded,
    draft: chat.draft || "",
  };
  const id = String(chat.id || "");
  let index = chatCache.findIndex((item) => item.id === id);
  if (index >= 0) {
    const existing = chatCache[index];
    chatCache[index] = {
      ...chatCache[index],
      ...normalized,
      avatarUrl: normalized.avatarUrl || chatCache[index].avatarUrl || "",
      messages: normalized.messages.length ? normalized.messages : chatCache[index].messages,
      draft: normalized.draft || chatCache[index].draft || "",
      unreadCount: normalized.unreadCount !== undefined ? normalized.unreadCount : chatCache[index].unreadCount,
      ...existing,
      name: chat.name !== undefined ? chat.name : existing.name,
      mssv: chat.mssv !== undefined ? chat.mssv : existing.mssv,
      avatarUrl: chat.avatarUrl || existing.avatarUrl || "",
      last: chat.last !== undefined ? chat.last : existing.last,
      lastTime: chat.lastTime !== undefined ? chat.lastTime : existing.lastTime,
      unreadCount: chat.unreadCount !== undefined ? chat.unreadCount : existing.unreadCount,
      messages: (chat.messages && chat.messages.length) ? chat.messages : existing.messages,
      loaded: chat.loaded !== undefined ? chat.loaded : existing.loaded,
      draft: chat.draft !== undefined ? chat.draft : existing.draft,
    };
  } else {
    chatCache.unshift(normalized);
    chatCache.unshift({
      id,
      name: chat.name || "Người dùng",
      mssv: chat.mssv || "",
      avatarUrl: chat.avatarUrl || "",
      last: chat.last || "",
      lastTime: chat.lastTime || "",
      unreadCount: chat.unreadCount || 0,
      messages: Array.isArray(chat.messages) ? chat.messages : [],
      loaded: !!chat.loaded,
      draft: chat.draft || "",
    });
  }

  chatCache.sort((a, b) => {
    const timeA = a.lastTime ? new Date(a.lastTime).getTime() : 0;
    const timeB = b.lastTime ? new Date(b.lastTime).getTime() : 0;
    return timeB - timeA;
  });

  return chatCache.find((item) => item.id === normalized.id);
  return chatCache.find((item) => item.id === id);
}

async function loadMessagesForChat(chat) {
  if (!chat) return;

  if (DEMO_PREVIEW_MODE) {
    chat.loaded = true;
    return;
  }

  if (!apiAvailable || !getToken()) return;

  const res = await apiFetch(`/api/messages/${encodeURIComponent(chat.id)}?limit=50`);
  chat.messages = (res.data || []).map((msg) => ({
    mine: msg.sender_id === currentUser?.id,
    text: msg.content || "",
    time: formatChatTime(msg.created_at),
    createdAt: msg.created_at || "",
    isRead: msg.is_read
  }));
  chat.loaded = true;

  if (chat.messages.length) {
    const latest = chat.messages[chat.messages.length - 1];
    chat.last = latest.text;
    chat.lastTime = latest.createdAt || chat.lastTime;
  }
}

async function openChat() {
  if (!currentUser) {
    openModal("loginModal");
    return;
  }

  await loadConversations();
  qs("chatPage").classList.add("open");
  chatManager.startPolling();
}

function closeChat() {
  qs("chatPage").classList.remove("open");
  chatManager.stopPolling();
}

async function openChatWith(idEncoded, nameEncoded, mssvEncoded = "", avatarUrlEncoded = "") {
  // Lưu lại tin nhắn đang gõ dở trước khi chuyển sang chat khác
  if (currentChatUser) {
    const currentInput = qs("chatInput");
    if (currentInput) {
      currentChatUser.draft = currentInput.value;
      localStorage.setItem('chatDraft_' + currentChatUser.id, currentInput.value);
    }
  }

  const id = decodeInline(idEncoded);
  const name = decodeInline(nameEncoded);
  const mssv = decodeInline(mssvEncoded);
  const avatarUrl = decodeInline(avatarUrlEncoded);
  
  const draft = localStorage.getItem('chatDraft_' + id) || '';

  const chat = upsertChat({
    id,
    name,
    mssv,
    avatarUrl,
    messages: [],
    loaded: false,
    draft,
  });
  currentChatUser = chat;
  
  if (chat.unreadCount > 0) {
    currentChatUser.unreadCount = 0;
    if (apiAvailable && getToken()) {
      apiFetch(`/api/messages/${encodeURIComponent(id)}/read`, { method: "POST" }).catch(console.error);
    }
  }

  renderChatList();
  updateNavBadge();

  const topAvatarHtml = (chat.avatarUrl)
    ? `<img src="${escapeHtml(chat.avatarUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='${escapeHtml(name.trim().slice(0,1).toUpperCase())}'"/>`
    : escapeHtml(name.trim().slice(0, 1).toUpperCase());

  qs("chatMain").innerHTML = `
    <div class="chat-top">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--c2),var(--c4));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;flex-shrink:0;overflow:hidden">
          ${topAvatarHtml}
        </div>
        <div>
          <div class="chat-top-name">${escapeHtml(name)}</div>
          ${mssv ? `<div style="font-size:0.78rem;color:var(--text-muted)">${escapeHtml(mssv)}</div>` : ""}
        </div>
      </div>
    </div>
    <div class="chat-messages" id="chatMsgs"></div>
    <div class="chat-input-row">
      <input id="chatInput" placeholder="Nhập tin nhắn..." value="${escapeHtml(chat.draft || '')}" oninput="if(currentChatUser) { currentChatUser.draft = this.value; localStorage.setItem('chatDraft_' + currentChatUser.id, this.value); renderChatList(); }" />
      <button class="btn-full" id="chatSendBtn" style="width:auto;padding:10px 20px;border-radius:999px" onclick="sendMsg()">
        <i class="fa-solid fa-paper-plane" style="font-size:0.85rem"></i>
      </button>
    </div>
  `;

  renderChatMessages();

  try {
    await loadMessagesForChat(chat);
    renderChatMessages();
    renderChatList();
  } catch (error) {
    showToast(error.message || "Không tải được tin nhắn", "error");
  }
}

async function startChatWith(idEncoded, nameEncoded, mssvEncoded = "", avatarUrlEncoded = "") {
  if (!currentUser) {
    closeModal("detailModal");
    openModal("loginModal");
    return;
  }
  const id = decodeInline(idEncoded);
  if (currentUser.id && id === currentUser.id) {
    showToast("Không thể chat với chính mình", "error");
    return;
  }
  closeModal("detailModal");
  await openChat();
  await openChatWith(idEncoded, nameEncoded, mssvEncoded, avatarUrlEncoded);
}

function renderChatMessages() {
  const box = qs("chatMsgs");
  if (!box || !currentChatUser) return;

  let html = "";
  if (!currentChatUser.messages.length) {
    html = `<div class="empty-state"><div class="detail-name">Chưa có tin nhắn</div><div class="verify-banner-text">Hãy bắt đầu cuộc trò chuyện đầu tiên.</div></div>`;
  } else {
    html = currentChatUser.messages.map((msg) => {
      return `<div class="msg-bubble ${msg.mine ? "msg-mine" : "msg-other"}">${escapeHtml(msg.text)}<div class="msg-time">${escapeHtml(msg.time)}</div></div>`;
    }).join("");
  }

  box.innerHTML = html;

  box.scrollTop = box.scrollHeight;
}

async function sendMsg() {
  const input = qs("chatInput");
  if (!input || !currentChatUser) return;

  const text = input.value.trim();
  if (!text) return;

  if (DEMO_PREVIEW_MODE) {
    currentChatUser.messages.push({
      mine: true,
      text,
      time: formatChatTime(new Date().toISOString()),
      createdAt: new Date().toISOString(),
    });
    currentChatUser.last = text;
    currentChatUser.draft = "";
    currentChatUser.lastTime = new Date().toISOString();
    input.value = "";
    renderChatMessages();
    renderChatList();
    return;
  }

  if (!apiAvailable || !getToken()) {
    showToast("Backend chưa chạy nên không thể gửi tin nhắn", "error");
    return;
  }

  const optimisticMessage = {
    mine: true,
    text,
    time: formatChatTime(new Date().toISOString()),
    createdAt: new Date().toISOString(),
  };

  input.value = "";
  currentChatUser.draft = "";
  currentChatUser.messages.push(optimisticMessage);
  currentChatUser.last = text;
  currentChatUser.lastTime = optimisticMessage.createdAt;
  renderChatMessages();
  renderChatList();

  try {
    setButtonLoading("chatSendBtn", true, ""); // Để rỗng để không bị ghi đè text, chỉ hiện vòng xoay load
    input.disabled = true;
    await apiFetch("/api/messages", {
      method: "POST",
      body: JSON.stringify({
        receiver_id: currentChatUser.id,
        content: text,
      }),
    });
    await loadMessagesForChat(currentChatUser);
    renderChatMessages();
    renderChatList();
  } catch (error) {
    currentChatUser.messages = currentChatUser.messages.filter((msg) => msg !== optimisticMessage);
    showToast(error.message || "Không thể gửi tin nhắn", "error");
    renderChatMessages();
    renderChatList();
  } finally {
    input.disabled = false;
    input.focus();
    setButtonLoading("chatSendBtn", false);
  }
}

function openAccount() {
  if (!currentUser) {
    openModal("loginModal");
    return;
  }
  renderAccountPage();
  qs("accountPage").classList.add("open");
}

function renderAccountPage() {
  const profile = currentProfile || {};
  const initials = (profile.full_name || currentUser?.email || "U").trim().slice(0, 1).toUpperCase();
  const avatarHtml = profile.avatar_url
    ? `<img src="${escapeHtml(profile.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='${escapeHtml(initials)}'">` 
    : escapeHtml(initials);

  qs("accountWrap").innerHTML = `
    <div class="account-card" style="background: transparent; border: none; box-shadow: none; padding: 0;">
      
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:32px">
        <button onclick="closeAllPages()" class="nav-icon-btn" style="width:42px;height:42px;display:flex;justify-content:center;align-items:center;border-radius:50%;flex-shrink:0;">
          <i class="fa-solid fa-arrow-left"></i>
        </button>
        <h1 style="margin:0;font-family:var(--font-head);font-size:1.6rem;color:var(--c1);flex:1;text-align:center">Hồ sơ cá nhân</h1>
        <div style="width:42px;flex-shrink:0"></div>
      </div>

      <!-- Avatar Section -->
      <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:32px;gap:16px">
        <div style="width:104px;height:104px;border-radius:50%;background:linear-gradient(135deg,var(--c2),var(--c4));color:#fff;font-size:2.5rem;font-weight:700;display:flex;align-items:center;justify-content:center;overflow:hidden;border:4px solid #fff;box-shadow:0 8px 24px rgba(18,52,77,0.12)">
          ${avatarHtml}
        </div>
        <div style="text-align:center">
          <div style="font-weight:800;font-size:1.35rem;color:var(--c1);letter-spacing:-0.02em;">${escapeHtml(profile.full_name || "—")}</div>
          <div style="font-size:0.9rem;color:var(--text-muted);margin-top:4px">${escapeHtml(currentUser?.email || "—")}</div>
        </div>
      </div>

      ${
        profile.is_verified
          ? `<div class="verified-banner" style="border-radius:16px;display:flex;align-items:center;gap:12px;padding:16px 20px;margin-bottom:24px;"><i class="fa-solid fa-circle-check" style="font-size:1.3rem;"></i><span style="font-weight:700;font-size:0.95rem;">Tài khoản sinh viên đã xác thực</span></div>`
          : `<div class="verify-banner" style="border-radius:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;margin-bottom:24px;"><div><div class="verify-banner-title" style="font-weight:800;color:var(--warn);margin-bottom:4px;display:flex;align-items:center;gap:6px;"><i class="fa-solid fa-triangle-exclamation"></i> Chưa xác thực</div><div class="verify-banner-text" style="font-size:0.85rem;">Xác nhận email trường để mở khóa tính năng.</div></div><button class="btn-primary" style="flex-shrink:0;padding:10px 18px;font-size:0.85rem;border-radius:99px;" onclick="openVerifyModal()">Xác thực</button></div>`
      }

      <!-- Info Group -->
      <div class="settings-group">
        <div style="padding:18px 20px;display:grid;gap:16px;">
          <div>
            <div style="font-size:0.75rem;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Mã số sinh viên</div>
            <div style="font-size:1.05rem;font-weight:700;color:var(--c1);">${escapeHtml(profile.mssv || "—")}</div>
          </div>
          <div style="height:1px;background:var(--border);"></div>
          <div>
            <div style="font-size:0.75rem;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Giới thiệu bản thân</div>
            <div style="font-size:0.95rem;color:var(--text);line-height:1.6;">${escapeHtml(profile.bio || "Chưa có lời giới thiệu nào.")}</div>
          </div>
        </div>
      </div>

      <!-- Actions Group -->
      <div class="settings-group">
        <button class="settings-item" onclick="openEditModal()">
          <div class="settings-item-icon"><i class="fa-solid fa-user-pen"></i></div>
          <div class="settings-item-text">Chỉnh sửa thông tin</div>
          <i class="fa-solid fa-chevron-right settings-item-arrow"></i>
        </button>
        <button class="settings-item" onclick="openModal('termsModal')">
          <div class="settings-item-icon"><i class="fa-solid fa-file-shield"></i></div>
          <div class="settings-item-text">Điều khoản sử dụng</div>
          <i class="fa-solid fa-chevron-right settings-item-arrow"></i>
        </button>
      </div>

      <div class="settings-group">
        <button class="settings-item danger" onclick="logout()">
          <div class="settings-item-icon"><i class="fa-solid fa-right-from-bracket"></i></div>
          <div class="settings-item-text">Đăng xuất khỏi thiết bị</div>
        </button>
      </div>

    </div>
  `;
}

function openEditModal() {
  if (!currentUser) {
    openModal("loginModal");
    return;
  }

  qs("editName").value = currentProfile?.full_name || "";
  qs("editBio").value = currentProfile?.bio || "";
  qs("editPass").value = "";
  if (qs("editAvatar")) qs("editAvatar").value = "";
  const previewEl = qs("editAvatarPreview");
  if (previewEl) {
    if (currentProfile?.avatar_url) {
      previewEl.innerHTML = `<img src="${currentProfile.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` ;
    } else {
      const initials = (currentProfile?.full_name || currentUser?.email || "U").trim().slice(0, 1).toUpperCase();
      previewEl.textContent = initials;
    }
  }
  clearAlert(qs("editSuccess"));
  openModal("editModal");
}

function previewAvatarFile(input) {
  const file = input.files[0];
  const previewEl = qs("editAvatarPreview");
  const fileNameEl = qs("editAvatarFileName");

  if (!file) return;

  if (fileNameEl) {
    fileNameEl.textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  }

  if (previewEl) {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewEl.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    };
    reader.readAsDataURL(file);
  }
}

async function doEdit() {
  const file = qs("editAvatar")?.files[0];
  let avatarUrl = currentProfile?.avatar_url || null;

  const fullName = qs("editName").value.trim();
  const bio = qs("editBio").value.trim();

  try {
    setButtonLoading("editBtn", true, "Đang lưu...");

    if (file) {
      avatarUrl = await uploadAvatar(file);
    }

    const payload = { full_name: fullName, bio };
    if (avatarUrl) {
      payload.avatar_url = avatarUrl;
    }

    if (apiAvailable && getToken() && !DEMO_PREVIEW_MODE) {
      const backendPayload = { full_name: fullName, bio };
      if (avatarUrl) {
        backendPayload.avatar_url = avatarUrl;
      }
      await apiFetch("/api/profile/me", {
        method: "PATCH",
        body: JSON.stringify(backendPayload),
      });
    }

    currentProfile = {
      ...currentProfile,
      full_name: fullName || currentProfile?.full_name,
      bio,
      ...(avatarUrl && { avatar_url: avatarUrl }),
    };
    persistSession();
    updateNavbar();
    renderCards();
    renderAccountPage();
    showAlert(qs("editSuccess"), "Cập nhật thành công! 🎉", true);
  } catch (error) {
    showToast(error.message || "Không thể cập nhật hồ sơ", "error");
  } finally {
    setButtonLoading("editBtn", false);
  }
}

function openVerifyModal() {
  if (!currentUser) {
    openModal("loginModal");
    return;
  }

  qs("verifyEmailDisplay").textContent = currentUser.email || "-";
  qs("otpStep1").style.display = "block";
  qs("otpStep2").style.display = "none";
  qs("verifyBtn").style.display = "none";
  qs("otpInput").value = "";
  clearAlert(qs("verifyError"));
  clearAlert(qs("verifySuccess"));
  openModal("verifyModal");
}

async function doSendOtp() {
  try {
    setButtonLoading("sendOtpBtn", true, "Đang gửi OTP...");
    if (!apiAvailable || !getToken() || DEMO_PREVIEW_MODE) {
      throw new Error("Backend chưa chạy nên không thể gửi OTP");
    }

    await apiFetch("/api/verify/send-otp", { method: "POST" });
    qs("otpStep1").style.display = "none";
    qs("otpStep2").style.display = "block";
    qs("verifyBtn").style.display = "inline-flex";
  } catch (error) {
    showAlert(qs("verifyError"), error.message || "Không gửi được OTP");
  } finally {
    setButtonLoading("sendOtpBtn", false);
  }
}

function resetOtpStep() {
  qs("otpStep1").style.display = "block";
  qs("otpStep2").style.display = "none";
  qs("verifyBtn").style.display = "none";
  qs("otpInput").value = "";
  clearAlert(qs("verifyError"));
  clearAlert(qs("verifySuccess"));
}

async function doVerifyOtp() {
  const otp = qs("otpInput").value.trim();
  clearAlert(qs("verifyError"));
  clearAlert(qs("verifySuccess"));

  if (!otp) {
    showAlert(qs("verifyError"), "Vui lòng nhập mã OTP");
    return;
  }

  try {
    setButtonLoading("verifyBtn", true, "Đang xác thực...");
    if (!apiAvailable || !getToken() || DEMO_PREVIEW_MODE) {
      throw new Error("Backend chưa chạy nên không thể xác thực OTP");
    }

    await apiFetch("/api/verify/confirm-otp", {
      method: "POST",
      body: JSON.stringify({ token: otp }),
    });

    currentProfile = { ...currentProfile, is_verified: true };
    persistSession();
    updateNavbar();
    renderAccountPage();
    showAlert(qs("verifySuccess"), "Xác thực thành công", true);
    showToast("Tài khoản đã được xác thực", "success");
  } catch (error) {
    showAlert(qs("verifyError"), error.message || "Xác thực thất bại");
  } finally {
    setButtonLoading("verifyBtn", false);
  }
}

function initOverlayClose() {
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.classList.remove("open");
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".chip-wrap")) {
      document.querySelectorAll(".chip-dropdown").forEach((el) => el.classList.remove("open"));
    }
    if (!event.target.closest(".user-menu-wrap")) {
      qs("userDropdown")?.classList.remove("open");
    }
  });
}

function updateSubjectFilter(requests) {
    const container = document.getElementById('dropSubject');
    if (!container || !requests) return;
    const subjects = [...new Set(requests.map(r => r.subject).filter(s => s))];
    let html = `<div class="chip-option" onclick="setFilter('subject','','dropSubject')">Tất cả</div>`;
    subjects.forEach(sub => {
        html += `<div class="chip-option" onclick="setFilter('subject','${sub}','dropSubject')">${sub}</div>`;
    });
    container.innerHTML = html;
}

async function init() {
  restoreSession();
  checkRecoveryFlow();
  if (DEMO_PREVIEW_MODE && !currentUser) {
    applyDemoPreview();
  }

  updateNavbar();
  initOverlayClose();
  await checkApiHealth();
  await loadCards();
  if (currentUser && getToken()) {
    await loadConversations();
  } else if (DEMO_PREVIEW_MODE) {
    renderChatList();
  } else {
    chatCache = [];
    renderChatList();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllModals();
      closeAllPages();
      document.querySelectorAll(".chip-dropdown").forEach((el) => el.classList.remove("open"));
      qs("userDropdown")?.classList.remove("open");
    }
  });

  // PHẦN BẮT SỰ KIỆN ENTER (NẰM TRONG INIT)
  const searchInput = qs("searchInput");
  if (searchInput) {
    searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        renderCards();
        showToast("Đang tìm kiếm...", "info");
      }
    });
  }

  const loginPass = qs("loginPassword");
  if (loginPass) {
    loginPass.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doLogin();
      }
    });
  }

  const regPassConfirm = qs("regPassConfirm");
  if (regPassConfirm) {
    regPassConfirm.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doRegister();
      }
    });
  }

  const postNote = qs("postNote");
  if (postNote) {
    postNote.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doPost();
      }
    });
  }
}

const historyManager = {
  editingRequestId: null,
  historyCache: [],

  openHistory: async function() {
    if (!currentUser) {
      showToast("Vui lòng đăng nhập để xem lịch sử", "error");
      return;
    }
    openModal('historyModal');
    const container = qs("historyList");
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Đang tải dữ liệu...</div>';
    
    try {
      const res = await apiFetch("/api/requests/history");
      if (res && res.success) {
        this.historyCache = res.data;
        this.renderHistory(this.historyCache);
      } else {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Không thể tải lịch sử</div>';
      }
    } catch (e) {
      console.error(e);
      container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Lỗi khi tải lịch sử</div>';
    }
  },

  renderHistory: function(data) {
    const container = qs("historyList");
    if (!data || data.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Bạn chưa tham gia lớp học nào</div>';
      return;
    }
    
    let html = '<div class="request-grid" style="display: flex; flex-direction: column; gap: 15px;">';
    data.forEach(item => {
      const isCreator = item.user_id === currentUser?.id;
      const roleText = isCreator 
        ? '<span style="color:var(--primary);font-size:0.85rem;font-weight:bold;margin-left:8px;">(Người tạo)</span>' 
        : '<span style="color:var(--success);font-size:0.85rem;font-weight:bold;margin-left:8px;">(Thành viên)</span>';
      
      const timeStr = new Date(item.created_at || Date.now()).toLocaleString("vi-VN", {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute:'2-digit'
      });
      
      const statusColor = item.status === 'open' ? 'var(--success)' : 'var(--text-muted)';
      const statusText = item.status === 'open' ? 'Đang mở' : 'Đã đóng';
      
      const typeBadge = item.type === "study" 
        ? '<span class="badge" style="background:#e3f2fd;color:#1976d2">Học nhóm</span>'
        : '<span class="badge" style="background:#fce4ec;color:#1565c0">Gia sư</span>';

      let noteHtml = '';
      if (item.note) {
        noteHtml = `<div style="font-size:0.9rem; color:var(--text); background: var(--bg); padding: 8px; border-radius: 6px; margin-top: 10px;"><i class="fa-solid fa-note-sticky" style="color:var(--text-muted); margin-right:5px;"></i> ${escapeHtml(item.note)}</div>`;
      }
      
      let linkHtml = '';
      if (item.location_or_link) {
        linkHtml = `<div style="font-size:0.9rem; margin-bottom:8px; display:flex; align-items:center; gap:8px;"><i class="fa-solid ${item.method === "online" ? "fa-link" : "fa-map-pin"}" style="color:var(--text-muted); width: 14px;"></i> <a href="${item.method === "online" ? escapeHtml(item.location_or_link) : '#'}" target="_blank" style="color:var(--primary); text-decoration:none; word-break: break-all;">${item.method === "online" ? 'Link buổi học' : escapeHtml(item.location_or_link)}</a></div>`;
      }

      const creatorProfile = item.profiles;
      const members = item.members || [];
      const allParticipants = [creatorProfile, ...members].filter(p => p && p.id);
      const uniqueParticipants = Array.from(new Map(allParticipants.map(p => [p.id, p])).values());

      let membersHtml = '';
      if (uniqueParticipants.length > 0) {
          membersHtml = `<div class="history-members-section" style="margin-top:12px;">
              <strong style="font-size:0.9rem; color: var(--text-muted); margin-bottom:8px; display:block;">Thành viên (${uniqueParticipants.length}/${item.slots || 'N/A'}):</strong>
              <div class="history-members-list" style="display:flex; flex-wrap:wrap; gap:8px;">
          `;
          uniqueParticipants.forEach(p => {
              const isP_Creator = p.id === item.user_id;
              const avatarUrl = p.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(p.full_name || 'U')}`;
              membersHtml += `
                  <div class="history-member-item" title="${escapeHtml(p.full_name)} (${isP_Creator ? 'Người tạo' : 'Thành viên'})" style="display:flex; align-items:center; gap: 6px; background: var(--bg); padding: 4px 8px; border-radius: 99px; font-size: 0.8rem;">
                      <img src="${avatarUrl}" alt="${escapeHtml(p.full_name)}" style="width:20px; height:20px; border-radius:50%;">
                      <span style="color: var(--text);">${escapeHtml(p.full_name.split(' ').pop())} ${isP_Creator ? '👑' : ''}</span>
                  </div>
              `;
          });
          membersHtml += `</div></div>`;
      }

      let profileHtml = '';
      if (item.profiles) {
        let actionsHtml = isCreator
          ? `<button class="btn btn-sm" style="background:var(--surface); border:1px solid var(--border);" onclick="historyManager.openEditRequestModal(${item.id})"><i class="fa-solid fa-pen-to-square"></i> Sửa</button>
             <button class="btn btn-sm" style="background:var(--danger-light); border:1px solid var(--danger); color: var(--danger); margin-left: 6px;" onclick="historyManager.deleteRequest(${item.id})"><i class="fa-solid fa-trash"></i> Xóa</button>`
          : `<button class="btn btn-sm" style="background:var(--danger-light); border:1px solid var(--danger); color: var(--danger);" onclick="historyManager.leaveRequest(${item.id})"><i class="fa-solid fa-arrow-right-from-bracket"></i> Rời nhóm</button>`;
        profileHtml = `
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border); display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <img src="${item.profiles.avatar_url || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(item.profiles.full_name || 'U')}" style="width: 24px; height: 24px; border-radius: 50%;">
                <span style="font-size: 0.85rem; color: var(--text-muted);">
                  Người đăng: <strong>${escapeHtml(item.profiles.full_name)}</strong>
                  ${item.profiles.is_verified ? '<i class="fa-solid fa-circle-check" style="color:var(--primary);" title="Đã xác thực"></i>' : ''}
                </span>
              </div>
              <div style="display:flex; gap:8px;">
                ${!isCreator ? `<button class="btn btn-sm" style="border:1px solid var(--border); background:var(--surface); cursor:pointer;" onclick="openChatWith('${encodeURIComponent(item.user_id)}', '${encodeURIComponent(item.profiles.full_name)}', '${encodeURIComponent(item.profiles.mssv || '')}', '${encodeURIComponent(item.profiles.avatar_url || '')}'); closeModal('historyModal');"><i class="fa-solid fa-comment"></i> Chat</button>` : ''}
                ${actionsHtml}
              </div>
            </div>
        `;
      }

      html += `
        <div class="request-card" style="cursor:default; padding: 15px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 10px;">
            <div>
              <h4 style="margin:0 0 5px 0; color:var(--text); display:flex; align-items:center;">
                ${escapeHtml(item.subject || "Không rõ")} ${roleText}
              </h4>
              <div style="font-size:0.85rem; color:var(--text-muted);">Đăng lúc: ${timeStr}</div>
            </div>
            <div style="display:flex; gap: 8px; align-items:center;">
              ${typeBadge}
              <span style="font-size:0.85rem; color:${statusColor}; font-weight:600;">${statusText}</span>
            </div>
          </div>
          
          <div class="request-meta" style="display:flex; gap:15px; margin-bottom: 10px; font-size:0.9rem;">
            <span title="Hình thức"><i class="fa-solid ${item.method === "online" ? "fa-video" : "fa-location-dot"}"></i> ${item.method === "online" ? "Online" : "Offline"}</span>
            <span title="Thời gian học"><i class="fa-solid fa-clock"></i> ${escapeHtml(item.time || "Thoả thuận")}</span>
            <span title="Số lượng"><i class="fa-solid fa-users"></i> ${item.current_slots || 0}/${item.slots || 0}</span>
          </div>
          
          ${linkHtml}
          ${noteHtml}
          ${membersHtml}
          ${profileHtml}
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;
  },

  openEditRequestModal: function(id) {
    const request = this.historyCache.find(item => item.id === id);
    if (!request) {
      showToast("Không tìm thấy yêu cầu để sửa", "error");
      return;
    }

    this.editingRequestId = id;

    qs("postModalTitle").textContent = "Chỉnh sửa yêu cầu";
    qs("postSubject").value = request.subject || "";
    qs("postTime").value = request.time || "";
    qs("postLink").value = request.method === 'online' ? (request.location_or_link || "") : "";
    qs("postLocation").value = request.method === 'offline' ? (request.location_or_link || "") : "";
    qs("postNote").value = request.note || "";
    qs("postSlots").value = request.slots || "4";
    qs("postMethod").value = request.method || "online";
    qs("postTutorRole").value = request.tutor_role || "seeking";
    
    qs("unverifiedPostWarn").style.display = "none";
    qs("tutorRoleField").style.display = request.type === "tutor" ? "block" : "none";
    toggleLocationField();

    const postBtn = qs("postBtn");
    postBtn.innerHTML = 'Lưu thay đổi';
    postBtn.onclick = () => historyManager.doEditRequest();

    openModal("postModal");
  },

  doEditRequest: async function() {
    if (!this.editingRequestId) return;

    const id = this.editingRequestId;
    const payload = {
      subject: qs("postSubject").value.trim(),
      method: qs("postMethod").value,
      time: qs("postTime").value.trim(),
      slots: Number(qs("postSlots").value || 4),
      note: qs("postNote").value.trim(),
      location_or_link: qs("postMethod").value === "online" ? qs("postLink").value.trim() : qs("postLocation").value.trim(),
      tutor_role: currentMode === "tutor" ? qs("postTutorRole").value : null,
    };

    if (!payload.subject || !payload.time || !payload.location_or_link) {
      showToast("Vui lòng nhập đủ thông tin bài đăng", "error");
      return;
    }

    try {
      setButtonLoading("postBtn", true, "Đang lưu...");
      await apiFetch(`/api/requests/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      await this.openHistory();
      await loadCards();
      this.resetPostModal();
      closeModal("postModal");
      showToast("Cập nhật thành công", "success");
    } catch (error) {
      showToast(error.message || "Không thể cập nhật", "error");
    } finally {
      setButtonLoading("postBtn", false);
      this.editingRequestId = null;
    }
  },

  deleteRequest: async function(id) {
    if (!confirm("Bạn có chắc chắn muốn xóa yêu cầu này vĩnh viễn?")) return;
    try {
      await apiFetch(`/api/requests/${id}`, { method: "DELETE" });
      await this.openHistory();
      await loadCards();
      showToast("Đã xóa yêu cầu thành công", "success");
    } catch (error) {
      showToast(error.message || "Không thể xóa yêu cầu", "error");
    }
  },

  leaveRequest: async function(id) {
    if (!confirm("Bạn có chắc muốn rời khỏi nhóm học này?")) return;
    try {
      await apiFetch(`/api/requests/${id}/join`, { method: "DELETE" });
      await this.openHistory();
      await loadCards();
      showToast("Rời nhóm thành công", "success");
    } catch (error) {
      showToast(error.message || "Không thể rời nhóm", "error");
    }
  },

  resetPostModal: function() {
    this.editingRequestId = null;
    qs("postModalTitle").textContent = currentMode === "study" ? "Tạo yêu cầu Study Buddy" : "Tạo yêu cầu Tutor";
    const postBtn = qs("postBtn");
    postBtn.innerHTML = 'Đăng bài';
    postBtn.onclick = () => doPost();
  }
};

window.historyManager = historyManager;

// Gọi hàm khởi động
init();
