const DEFAULT_API = "https://uit-test.onrender.com";
const SAVED_API = localStorage.getItem("sb_api_base");
const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const API_BASE = SAVED_API ? SAVED_API : (IS_LOCAL ? "http://localhost:8000" : DEFAULT_API);

let apiAvailable = false;
let currentUser = null;
let currentProfile = null;
let currentMode = "study";
let allCards = [];
let activeFilters = { year: "", subject: "", method: "", is_verified: "" };
let currentChatUser = null;
let chatCache = [];
let resetRecoveryActive = false;

const DEMO_PREVIEW_MODE = false; 

function qs(id) {
  return document.getElementById(id);
}

function getToken() {
  return localStorage.getItem("sb_access_token") || "";
}

function setToken(token) {
  if (token) {
    localStorage.setItem("sb_access_token", token);
  } else {
    localStorage.removeItem("sb_access_token");
  }
}

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
    button.dataset.originalText = button.textContent;
  }

  if (loading) {
    button.disabled = true;
    button.classList.add("btn-loading");
    button.setAttribute("aria-busy", "true");
    if (loadingText) button.textContent = loadingText;
  } else {
    button.disabled = false;
    button.classList.remove("btn-loading");
    button.removeAttribute("aria-busy");
    button.textContent = button.dataset.originalText || button.textContent;
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
    modal.classList.add("open");
    modal.style.display = "flex"; 
    modal.style.zIndex = "9999";  
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

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Authorization") && getToken()) {
    headers.set("Authorization", `Bearer ${getToken()}`);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await response.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { detail: text };
  }

  if (!response.ok) {
    throw new Error(data.detail || data.message || "Yêu cầu thất bại");
  }

  return data;
}

async function checkApiHealth() {
  try {
    await apiFetch("/api/health");
    apiAvailable = true;
  } catch {
    apiAvailable = false;
  }
}

function renderAvatar(user) {
  const el = document.getElementById('navAvatar');

  if (user.avatar_url) {
    el.innerHTML = `<img src="${user.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  } else {
    el.innerText = user.name ? user.name[0] : "U";
  }
}

function persistSession() {
  if (currentUser && currentProfile) {
    localStorage.setItem(
      "sb_session",
      JSON.stringify({ user: currentUser, profile: currentProfile })
    );
  } else {
    localStorage.removeItem("sb_session");
  }
}

function restoreSession() {
  const raw = localStorage.getItem("sb_session");
  if (!raw) return;

  try {
    const saved = JSON.parse(raw);
    currentUser = saved.user || null;
    currentProfile = saved.profile || null;
  } catch {
    localStorage.removeItem("sb_session");
  }
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
    setButtonLoading("loginBtn", true, "Đang gửi email...");
    if (!apiAvailable) {
      throw new Error("Backend chưa chạy nên không thể gửi email đặt lại mật khẩu");
    }

    const res = await apiFetch("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    showAlert(errorEl, res.message || "Đã gửi email đặt lại mật khẩu", true);
  } catch (error) {
    showAlert(errorEl, error.message || "Không thể gửi email đặt lại mật khẩu");
  } finally {
    setButtonLoading("loginBtn", false);
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
            const lastMsg = chat.last ? escapeHtml(chat.last) : '<span style="font-style:italic;opacity:0.7">Chưa có tin nhắn</span>';
            const isActive = currentChatUser && currentChatUser.id === chat.id;
            const avatarContent = chat.avatarUrl
              ? `<img src="${escapeHtml(chat.avatarUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='${escapeHtml(initial)}'">`
              : escapeHtml(initial);
            return `
              <div class="chat-item-card${isActive ? ' active' : ''}" onclick="openChatWith('${encodeInline(chat.id)}','${encodeInline(chat.name)}','${encodeInline(chat.mssv || '')}','${encodeInline(chat.avatarUrl || '')}')">
                <div class="chat-item-avatar-wrap">${avatarContent}</div>
                <div class="chat-item-info">
                  <div class="chat-item-name">${escapeHtml(chat.name || 'Người dùng')}</div>
                  <div class="chat-item-last">${lastMsg}</div>
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
    chatCache = (res.data || []).map((item) => ({
      id: String(item.user_id),
      name: item.full_name || "Người dùng",
      mssv: item.mssv || "",
      avatarUrl: item.avatar_url || "",
      last: item.last_message || "",
      lastTime: item.last_time || "",
      messages: [],
      loaded: false,
    }));
    renderChatList();
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
    messages: Array.isArray(chat.messages) ? chat.messages : [],
    loaded: !!chat.loaded,
  };

  const index = chatCache.findIndex((item) => item.id === normalized.id);
  if (index >= 0) {
    chatCache[index] = {
      ...chatCache[index],
      ...normalized,
      avatarUrl: normalized.avatarUrl || chatCache[index].avatarUrl || "",
      messages: normalized.messages.length ? normalized.messages : chatCache[index].messages,
    };
  } else {
    chatCache.unshift(normalized);
  }

  chatCache.sort((a, b) => {
    const timeA = a.lastTime ? new Date(a.lastTime).getTime() : 0;
    const timeB = b.lastTime ? new Date(b.lastTime).getTime() : 0;
    return timeB - timeA;
  });

  return chatCache.find((item) => item.id === normalized.id);
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
}

function closeChat() {
  qs("chatPage").classList.remove("open");
}

async function openChatWith(idEncoded, nameEncoded, mssvEncoded = "", avatarUrlEncoded = "") {
  const id = decodeInline(idEncoded);
  const name = decodeInline(nameEncoded);
  const mssv = decodeInline(mssvEncoded);
  const avatarUrl = decodeInline(avatarUrlEncoded);

  const chat = upsertChat({
    id,
    name,
    mssv,
    avatarUrl,
    messages: [],
    loaded: false,
  });
  currentChatUser = chat;
  renderChatList();

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
      <button class="modal-close" onclick="closeChat()" title="Đóng">✕</button>
    </div>
    <div class="chat-messages" id="chatMsgs"></div>
    <div class="chat-input-row">
      <input id="chatInput" placeholder="Nhập tin nhắn..." />
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

  box.innerHTML = currentChatUser.messages.length
    ? currentChatUser.messages
        .map(
          (msg) =>
            `<div class="msg-bubble ${msg.mine ? "msg-mine" : "msg-other"}">${escapeHtml(msg.text)}<div class="msg-time">${escapeHtml(msg.time)}</div></div>`
        )
        .join("")
    : `<div class="empty-state"><div class="detail-name">Chưa có tin nhắn</div><div class="verify-banner-text">Hãy bắt đầu cuộc trò chuyện đầu tiên.</div></div>`;

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
  currentChatUser.messages.push(optimisticMessage);
  currentChatUser.last = text;
  currentChatUser.lastTime = optimisticMessage.createdAt;
  renderChatMessages();
  renderChatList();

  try {
    setButtonLoading("chatSendBtn", true, "Đang gửi...");
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
    <div class="account-card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px">
        <button onclick="closeAllPages()" style="
          background:var(--bg-card);
          border:1.5px solid var(--border);
          padding:6px 12px;
          border-radius:8px;
          color:var(--c1);
          font-size:0.82rem;
          font-weight:600;
          cursor:pointer;
          white-space:nowrap;
          flex-shrink:0;
          display:flex;align-items:center;gap:6px;
        "><i class="fa-solid fa-arrow-left" style="font-size:0.75rem"></i> Trang chủ</button>
        <h1 style="margin:0;font-family:var(--font-head);font-size:1.4rem;color:var(--c1);flex:1;text-align:center">Tài khoản của tôi</h1>
        <div style="width:80px;flex-shrink:0"></div>
      </div>

      <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:24px;gap:12px">
        <div style="
          width:88px;height:88px;border-radius:50%;
          background:linear-gradient(135deg,var(--c2),var(--c4));
          color:#fff;font-size:2rem;font-weight:700;
          display:flex;align-items:center;justify-content:center;
          overflow:hidden;border:3px solid var(--border);
          box-shadow:0 4px 16px rgba(18,52,77,0.12)
        ">${avatarHtml}</div>
        <div style="text-align:center">
          <div style="font-weight:700;font-size:1.1rem;color:var(--c1)">${escapeHtml(profile.full_name || "—")}</div>
          <div style="font-size:0.82rem;color:var(--text-muted);margin-top:2px">${escapeHtml(currentUser?.email || "—")}</div>
        </div>
      </div>

      ${
        profile.is_verified
          ? `<div class="verified-banner">✅ Tài khoản đã được xác thực</div>`
          : `<div class="verify-banner" style="display:flex;align-items:center;justify-content:space-between;gap:12px"><div><div class="verify-banner-title" style="font-weight:700;color:var(--warn)">Chưa xác thực</div><div class="verify-banner-text">Xác thực email trường để tăng uy tín.</div></div><button class="btn-primary" style="flex-shrink:0;padding:8px 14px;font-size:0.82rem" onclick="openVerifyModal()">Xác thực ngay</button></div>`
      }

      <div style="display:grid;gap:8px;margin-bottom:20px">
        <div class="profile-info-row"><span class="profile-info-label">MSSV</span><span class="profile-info-value">${escapeHtml(profile.mssv || "—")}</span></div>
        <div class="profile-info-row"><span class="profile-info-label">Bio</span><span class="profile-info-value">${escapeHtml(profile.bio || "Chưa có giới thiệu")}</span></div>
      </div>

      <div style="display:grid;gap:10px">
        <button class="btn-full secondary" onclick="openEditModal()"><i class="fa-solid fa-pen" style="margin-right:8px;font-size:0.85rem"></i>Chỉnh sửa thông tin</button>
        ${!profile.is_verified ? `<button class="btn-full" onclick="openVerifyModal()"><i class="fa-solid fa-envelope" style="margin-right:8px;font-size:0.85rem"></i>Xác thực Email trường</button>` : ""}
        <button class="btn-full secondary" onclick="openModal('termsModal')"><i class="fa-solid fa-file-lines" style="margin-right:8px;font-size:0.85rem"></i>Điều khoản sử dụng</button>
        <button class="btn-full" style="background:linear-gradient(135deg,var(--danger),#e05c5c)" onclick="logout()"><i class="fa-solid fa-right-from-bracket" style="margin-right:8px;font-size:0.85rem"></i>Đăng xuất</button>
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

// Gọi hàm khởi động
init();
