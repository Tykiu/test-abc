function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = nextTheme;
  localStorage.setItem("sb_theme", nextTheme);

  const icon = qs("themeToggleIcon");
  const button = qs("themeToggleBtn");
  if (icon) icon.className = nextTheme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
  if (button) {
    const label = nextTheme === "dark" ? "Chuyen sang che do sang" : "Chuyen sang che do toi";
    button.title = label;
    button.setAttribute("aria-label", label);
  }
}

function toggleTheme() {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
}

function initTheme() {
  const savedTheme = localStorage.getItem("sb_theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme || (prefersDark ? "dark" : "light"));
}

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

    if (!response.ok) {
      let errMsg = data.detail || data.message || "Yêu cầu thất bại";
      if (typeof errMsg === "object") {
        errMsg = Array.isArray(errMsg) ? errMsg.map(e => e.msg || JSON.stringify(e)).join(", ") : JSON.stringify(errMsg);
      }
      throw new Error(errMsg);
    }
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

class VerificationManager {
  openModal() {
    if (!currentUser) {
      openModal("loginModal");
      return;
    }

    const displayEmail = currentProfile?.mssv ? `${currentProfile.mssv}@gm.uit.edu.vn` : (currentUser?.email || "-");
    qs("verifyEmailDisplay").textContent = displayEmail;

    qs("otpStep1").style.display = "none";
    qs("otpStep2").style.display = "block";
    qs("verifyBtn").style.display = "inline-flex";

    qs("otpInput").value = "";
    clearAlert(qs("verifyError"));
    clearAlert(qs("verifySuccess"));
    openModal("verifyModal");

    // Tự động gửi OTP
    this.sendOtp(false);
  }

  async sendOtp(isResend = false) {
    const verifyBtn = qs("verifyBtn");

    if (!isResend) {
      setButtonLoading(verifyBtn, true, "Đang gửi OTP...");
    }
    clearAlert(qs("verifyError"));

    try {
      if (!apiAvailable || !getToken() || DEMO_PREVIEW_MODE) throw new Error("Backend chưa chạy nên không thể gửi OTP");

      await apiFetch("/api/verify/send-otp", { method: "POST" });
      showToast(isResend ? "Đã gửi lại mã OTP." : "Đã gửi mã OTP. Vui lòng kiểm tra email.", "success");
    } catch (error) {
      showAlert(qs("verifyError"), error.message || "Không gửi được OTP");
    } finally {
      if (!isResend) setButtonLoading(verifyBtn, false);
    }
  }

  async verifyOtp() {
    const otp = qs("otpInput").value.trim();
    clearAlert(qs("verifyError"));
    clearAlert(qs("verifySuccess"));

    if (!otp) {
      showAlert(qs("verifyError"), "Vui lòng nhập mã OTP");
      return;
    }

    try {
      setButtonLoading("verifyBtn", true, "Đang xác thực...");
      if (!apiAvailable || !getToken() || DEMO_PREVIEW_MODE) throw new Error("Backend chưa chạy nên không thể xác thực OTP");

      await apiFetch("/api/verify/confirm-otp", { method: "POST", body: JSON.stringify({ token: otp }) });

      currentProfile = { ...currentProfile, is_verified: true };
      persistSession();
      updateNavbar();
      renderAccountPage();
      showAlert(qs("verifySuccess"), "Xác thực thành công", true);
      showToast("Tài khoản đã được xác thực", "success");
      setTimeout(() => closeModal("verifyModal"), 1500);
    } catch (error) {
      showAlert(qs("verifyError"), error.message || "Xác thực thất bại");
    } finally {
      setButtonLoading("verifyBtn", false);
    }
  }
}

const api = new ApiClient();
const sessionManager = new SessionManager();
const chatManager = new ChatManager();
const verificationManager = new VerificationManager();

let apiAvailable = false;
let currentUser = null;
let currentProfile = null;
let currentMode = "dashboard";
let allCards = [];
let activeFilters = { year: "", subject: "", method: "", tutor_role: "", sort: "newest" };
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

// UIT SUBJECTS - Danh mục môn học từ daa.uit.edu.vn
const UIT_SUBJECTS = [
  { code: "ACCT3603", name: "Hệ thống thông tin kế toán" },
  { code: "ACCT5123", name: "Hoạch định nguồn lực doanh nghiệp" },
  { code: "ADENG1", name: "Tiếng Anh tăng cường 1" },
  { code: "ADENG2", name: "Tiếng Anh tăng cường 2" },
  { code: "ADENG3", name: "Tiếng Anh tăng cường 3" },
  { code: "ADENG4", name: "Tiếng Anh tăng cường 4" },
  { code: "AI001", name: "Giới thiệu ngành Trí tuệ nhân tạo" },
  { code: "AI002", name: "Tư duy Trí tuệ nhân tạo" },
  { code: "AI301", name: "Khởi nghiệp và sáng tạo" },
  { code: "AI302", name: "Kỹ thuật viết báo cáo và trình bày" },
  { code: "AI503", name: "Đồ án tốt nghiệp" },
  { code: "AI504", name: "Đồ án tốt nghiệp tại doanh nghiệp" },
  { code: "AI505", name: "Khoá luận tốt nghiệp" },
  { code: "BCH058", name: "Kỹ năng truyền thông giao tiếp" },
  { code: "BOQC1", name: "Nhập môn máy tính lượng tử" },
  { code: "BUS1125", name: "Khởi nghiệp kinh doanh" },
  { code: "CARC1", name: "Kiến trúc máy tính" },
  { code: "CE005", name: "Giới thiệu ngành Kỹ Thuật Máy tính" },
  { code: "CE006", name: "Giới thiệu ngành Thiết kế vi mạch" },
  { code: "CE101", name: "Lý thuyết mạch điện" },
  { code: "CE102", name: "Hệ thống số" },
  { code: "CE103", name: "Vi xử lý-vi điều khiển" },
  { code: "CE104", name: "Các thiết bị và mạch điện tử" },
  { code: "CE105", name: "Xử lý tín hiệu số" },
  { code: "CE106", name: "Thiết kế vi mạch với HDL" },
  { code: "CE107", name: "Hệ thống nhúng" },
  { code: "CE108", name: "Hệ điều hành nâng cao" },
  { code: "CE109", name: "Lập trình nhúng căn bản" },
  { code: "CE110", name: "Lập trình hệ thống với Java" },
  { code: "CE111", name: "Kiến trúc máy tính nâng cao" },
  { code: "CE112", name: "Đồ án môn học thiết kế mạch" },
  { code: "CE113", name: "Điều khiển tự động" },
  { code: "CE114", name: "Lập trình trên thiết bị di động" },
  { code: "CE115", name: "Thiết kế mạng" },
  { code: "CE116", name: "Đồ án môn học ngành KTMT" },
  { code: "CE117", name: "Thực hành điện- điện tử" },
  { code: "CE118", name: "Thiết kế luận lý số" },
  { code: "CE119", name: "Thực hành kiến trúc máy tính" },
  { code: "CE121", name: "Lý thuyết mạch điện" },
  { code: "CE122", name: "Phân tích mạch kỹ thuật" },
  { code: "CE124", name: "Các thiết bị và mạch điện tử" },
  { code: "CE125", name: "Kỹ thuật phân tích mạch" },
  { code: "CE126", name: "Vật lý bán dẫn và ứng dụng" },
  { code: "CE201", name: "Đồ án 1" },
  { code: "CE202", name: "An toàn mạng máy tính" },
  { code: "CE203", name: "Điều khiển tự động nâng cao" },
  { code: "CE204", name: "Thiết kế và lập trình Web" },
  { code: "CE205", name: "Xử lý tín hiệu số" },
  { code: "CE206", name: "Đồ án 2" },
  { code: "CE207", name: "Đồ án thiết kế vi mạch 1" },
  { code: "CE208", name: "Đồ án thiết kế vi mạch 2" },
  { code: "CE211", name: "Lập trình nhúng căn bản" },
  { code: "CE212", name: "Điều khiển tự động" },
  { code: "CE213", name: "Thiết kế hệ thống số với HDL" },
  { code: "CE219", name: "Tương tác người - máy" },
  { code: "CE221", name: "Thiết kế vi mạch với HDL" },
  { code: "CE222", name: "Thiết kế vi mạch số" },
  { code: "CE224", name: "Thiết kế hệ thống nhúng" },
  { code: "CE226", name: "Thiết kế VLSI" },
  { code: "CE232", name: "Thiết kế hệ thống nhúng không dây" },
  { code: "CE233", name: "Kỹ thuật Robot" },
  { code: "CE301", name: "Hệ thống chứng thực số" },
  { code: "CE302", name: "Thiết kế vi mạch" },
  { code: "CE303", name: "Robot công nghiệp" },
  { code: "CE3031", name: "Công nghệ cảm biến" },
  { code: "CE304", name: "Robot công nghiệp" },
  { code: "CE306", name: "Thị giác máy tính" },
  { code: "CE312", name: "Hệ thống thời gian thực" },
  { code: "CE313", name: "Xử lý song song và hệ thống phân tán" },
  { code: "CE314", name: "Trình biên dịch" },
  { code: "CE315", name: "Lập trình hệ thống với Java" },
  { code: "CE316", name: "Logic mờ và ứng dụng" },
  { code: "CE317", name: "Điều khiển tự động nâng cao" },
  { code: "CE318", name: "Trình biên dịch" },
  { code: "CE319", name: "Logic mờ và ứng dụng" },
  { code: "CE320", name: "Logic mờ cho ứng dụng hệ thống nhúng" },
  { code: "CE321", name: "Kỹ thuật chế tạo vi mạch" },
  { code: "CE322", name: "Thiết kế vi mạch hỗn hợp" },
  { code: "CE323", name: "Kỹ thuật thiết kế mạch in" },
  { code: "CE324", name: "Thiết kế vi mạch tương tự" },
  { code: "CE325", name: "Thiết kế dựa trên vi xử lý" },
  { code: "CE326", name: "Tự động hóa thiết kế vi mạch" },
  { code: "CE327", name: "Tối ưu hóa dựa trên FPGA" },
  { code: "CE331", name: "Kỹ thuật chế tạo vi mạch" },
  { code: "CE332", name: "Thiết kế vi mạch hỗn hợp" },
  { code: "CE333", name: "Tiếng Anh chuyên ngành Kỹ thuật máy tính" },
  { code: "CE334", name: "Thiết kế vi mạch tương tự" },
  { code: "CE335", name: "Thiết kế dựa trên vi xử lý" },
  { code: "CE336", name: "Tự động hóa thiết kế vi mạch" },
  { code: "CE337", name: "Tối ưu hóa dựa trên FPGA" },
  { code: "CE338", name: "Hệ thống thời gian thực" },
  { code: "CE339", name: "Công nghệ IoT và ứng dụng" },
  { code: "CE340", name: "Trí tuệ nhân tạo cho hệ thống nhúng" },
  { code: "CE341", name: "Lập trình nhúng trên thiết bị di động" },
  { code: "CE342", name: "Hệ thống thông minh" },
  { code: "CE343", name: "Trí tuệ nhân tạo cho xe tự hành" },
  { code: "CE344", name: "Trí tuệ nhân tạo cho IoT" },
  { code: "CE345", name: "Kiến trúc IoT: giao thức mạng và bảo mật" },
  { code: "CE346", name: "Thiết kế Ăng-ten tích hợp cho thiết bị IoT" },
  { code: "CE347", name: "Điều khiển thông minh cho robot" },
  { code: "CE348", name: "Công nghệ cảm biến trong IoT" },
  { code: "CE349", name: "Hệ thống nhúng trên SoC" },
  { code: "CE350", name: "Xử lý ảnh hướng ASIC" },
  { code: "CE351", name: "Thiết kế bộ tăng tốc phần cứng" },
  { code: "CE352", name: "Xử lý tín hiệu số trên FPGA" },
  { code: "CE353", name: "Thiết kế vật lý vi mạch" },
  { code: "CE401", name: "Kỹ thuật hệ thống máy tính" },
  { code: "CE402", name: "Các hệ điều hành nhúng" },
  { code: "CE403", name: "Thiết kế số" },
  { code: "CE404", name: "Kỹ thuật chế tạo vi mạch" },
  { code: "CE405", name: "Tương tác người-máy" },
  { code: "CE406", name: "Tương tác người-máy" },
  { code: "CE407", name: "Đồ án chuyên ngành hệ thống nhúng và robot" },
  { code: "CE408", name: "Đồ án chuyên ngành thiết kế vi mạch và phần cứng" },
  { code: "CE409", name: "Kỹ thuật thiết kế kiểm tra" },
  { code: "CE410", name: "Kỹ thuật hệ thống máy tính" },
  { code: "CE411", name: "Chuyên đề hệ thống nhúng và robot" },
  { code: "CE412", name: "Đồ án chuyên ngành hệ thống nhúng và IoT" },
  { code: "CE413", name: "Đồ án chuyên ngành Robotics và AI" },
  { code: "CE421", name: "Chuyên đề thiết kế vi mạch và phần cứng" },
  { code: "CE430", name: "Lập trình hệ thống" },
  { code: "CE432", name: "Thiết kế vi mạch hướng ASIC" },
  { code: "CE433", name: "Thiết kế hệ thống SoC" },
  { code: "CE434", name: "Chuyên đề thiết kế hệ vi mạch 1" },
  { code: "CE435", name: "Chuyên đề thiết kế hệ vi mạch 2" },
  { code: "CE436", name: "Xử lý tín hiệu số và ứng dụng" },
  { code: "CE437", name: "Chuyên đề thiết kế hệ thống nhúng 1" },
  { code: "CE438", name: "Chuyên đề thiết kế hệ thống nhúng 2" },
  { code: "CE439", name: "Lập trình song song và hệ thống phân tán" },
  { code: "CE440", name: "Hệ thống định vị với ứng dụng Artificial Intelligence" },
  { code: "CE441", name: "Chuyên đề thiết kế Robotics và Artificial Intelligence 1" },
  { code: "CE442", name: "Chuyên đề thiết kế Robotics và Artificial Intelligence 2" },
  { code: "CE501", name: "Thực tập doanh nghiệp" },
  { code: "CE502", name: "Thực tập doanh nghiệp" },
  { code: "CE505", name: "Khóa luận tốt nghiệp" },
  { code: "CE506", name: "Luận văn chuyên sâu đặc thù" },
  { code: "CE507", name: "Đồ án tốt nghiệp tại doanh nghiệp" },
  { code: "CE508", name: "Đồ án tốt nghiệp" },
  { code: "CE510", name: "Chuyên đề tốt nghiệp định hướng hệ thống nhúng và IoT" },
  { code: "CE511", name: "Chuyên đề tốt nghiệp định hướng Robotic và trí tuệ nhân tạo" },
  { code: "CE512", name: "Chuyên đề tốt nghiệp định hướng thiết kế vi mạch" },
  { code: "CM101", name: "Quản lý giao tiếp" },
  { code: "CNBU001", name: "Mạng máy tính" },
  { code: "CNBU002", name: "Bảo mật" },
  { code: "CNBU003", name: "Dự án nghiên cứu" },
  { code: "CNBU004", name: "Thiết kế và phát triển website" },
  { code: "CNBU005", name: "Internet of Things" },
  { code: "CNBU006", name: "An toàn mạng máy tính" },
  { code: "CNBU007", name: "Pháp chứng kỹ thuật số" },
  { code: "CNBU008", name: "Quản lý an toàn thông tin" },
  { code: "CNBU009", name: "Thực tập" },
  { code: "CNBU101", name: "Toán cho tin học" },
  { code: "CNBU102", name: "Công nghệ mạng máy tính" },
  { code: "CNBU103", name: "Lập trình cho kỹ sư mạng máy tính" },
  { code: "CNBU104", name: "Hệ thống Servers" },
  { code: "CNBU105", name: "Hệ thống mạng doanh nghiệp" },
  { code: "CNBU106", name: "Hoạt động an ninh mạng" },
  { code: "CNBU107", name: "Dự án chuyên ngành" },
  { code: "CNBU108", name: "Hệ điều hành" },
  { code: "CNBU201", name: "Công nghệ mạng không dây" },
  { code: "CNBU202", name: "Hệ thống tường lửa nâng cao" },
  { code: "CNBU203", name: "An toàn mạng máy tính" },
  { code: "CNBU204", name: "Ethical Hacking" },
  { code: "CNBU205", name: "Dự án cá nhân" },
  { code: "CNET1", name: "Mạng máy tính" },
  { code: "CS003", name: "Máy học nâng cao" },
  { code: "CS004", name: "Máy học trong xử lý ngôn ngữ tự nhiên" },
  { code: "CS005", name: "Giới thiệu ngành Khoa học Máy tính" },
  { code: "CS010", name: "Các công cụ của trí tuệ nhân tạo" },
  { code: "CS013", name: "Máy học nâng cao" },
  { code: "CS014", name: "Máy học trong xử lý ngôn ngữ tự nhiên" },
  { code: "CS019", name: "Chuyên đề ứng dụng Trí tuệ nhân tạo" },
  { code: "CS101", name: "Nguyên lý và phương pháp lập trình" },
  { code: "CS102", name: "Phân tích & thiết kế thuật toán" },
  { code: "CS103", name: "Cơ sở lập trình" },
  { code: "CS104", name: "Nhập môn công nghệ phần mềm" },
  { code: "CS105", name: "Đồ họa máy tính" },
  { code: "CS106", name: "Trí tuệ nhân tạo" },
  { code: "CS107", name: "Các hệ cơ sở tri thức" },
  { code: "CS108", name: "Lý thuyết thông tin" },
  { code: "CS109", name: "Máy học" },
  { code: "CS110", name: "Nhập môn công nghệ tri thức và máy học" },
  { code: "CS111", name: "Nguyên lý và phương pháp lập trình" },
  { code: "CS1113", name: "Khoa học máy tính 1" },
  { code: "CS112", name: "Phân tích và thiết kế thuật toán" },
  { code: "CS113", name: "Đồ họa máy tính và xử lý ảnh" },
  { code: "CS114", name: "Máy học" },
  { code: "CS115", name: "Toán cho khoa học máy tính" },
  { code: "CS116", name: "Lập trình Python cho máy học" },
  { code: "CS117", name: "Tư duy tính toán" },
  { code: "CS124", name: "Nhập môn công nghệ phần mềm" },
  { code: "CS210", name: "Xử lý ngôn ngữ tự nhiên nâng cao" },
  { code: "CS211", name: "Trí tuệ nhân tạo nâng cao" },
  { code: "CS212", name: "Xử lý ngôn ngữ tự nhiên" },
  { code: "CS213", name: "Ngôn ngữ học máy tính" },
  { code: "CS2133", name: "Khoa học máy tính 2" },
  { code: "CS2134", name: "Khoa học máy tính" },
  { code: "CS214", name: "Biểu diễn tri thức và suy luận" },
  { code: "CS217", name: "Các hệ cơ sở tri thức" },
  { code: "CS221", name: "Xử lý ngôn ngữ tự nhiên" },
  { code: "CS222", name: "Xử lý ngôn ngữ tự nhiên nâng cao" },
  { code: "CS223", name: "Máy học nâng cao" },
  { code: "CS224", name: "Máy học xử lý ngôn ngữ tự nhiên" },
  { code: "CS225", name: "Lập trình symbolic trong trí tuệ nhân tạo" },
  { code: "CS226", name: "Ngôn ngữ học máy tính" },
  { code: "CS227", name: "Khai thác dữ liệu và ứng dụng" },
  { code: "CS228", name: "Máy học và ứng dụng" },
  { code: "CS229", name: "Ngữ nghĩa học tính toán" },
  { code: "CS231", name: "Nhập môn thị giác máy tính" },
  { code: "CS232", name: "Tính toán đa phương tiện" },
  { code: "CS233", name: "Nhận dạng Thị giác" },
  { code: "CS2433", name: "Lập trình C/C++" },
  { code: "CS301", name: "Chuyên đề nghiên cứu khoa học" },
  { code: "CS302", name: "Seminar" },
  { code: "CS311", name: "Kỹ thuật lập trình trí tuệ nhân tạo" },
  { code: "CS312", name: "Hệ thống đa tác tử" },
  { code: "CS313", name: "Khai thác dữ liệu và ứng dụng" },
  { code: "CS314", name: "Lập trình symbolic trong trí tuệ nhân tạo" },
  { code: "CS315", name: "Máy học nâng cao" },
  { code: "CS316", name: "Các hệ giải bài toán thông minh" },
  { code: "CS317", name: "Phát triển và vận hành hệ thống máy học" },
  { code: "CS321", name: "Ngôn ngữ học ngữ liệu" },
  { code: "CS322", name: "Biểu diễn tri thức và ứng dụng" },
  { code: "CS323", name: "Các hệ thống hỏi-đáp" },
  { code: "CS324", name: "Máy học trong xử lý ngôn ngữ tự nhiên" },
  { code: "CS325", name: "Dịch máy" },
  { code: "CS326", name: "Các kĩ thuật trong xử lý ngôn ngữ tự nhiên" },
  { code: "CS331", name: "Thị giác máy tính nâng cao" },
  { code: "CS332", name: "Máy học trong thị giác máy tính" },
  { code: "CS333", name: "Đồ họa game" },
  { code: "CS334", name: "Lập trình tính toán hình thức" },
  { code: "CS335", name: "Tìm kiếm ảnh và video" },
  { code: "CS336", name: "Truy vấn thông tin đa phương tiện" },
  { code: "CS3363", name: "Tổ chức ngôn ngữ lập trình" },
  { code: "CS337", name: "Xử lý âm thanh và tiếng nói" },
  { code: "CS3373", name: "Lập trình hướng đối tượng nâng cao cho môi trường windows" },
  { code: "CS338", name: "Nhận dạng" },
  { code: "CS339", name: "Xử lý văn bản y khoa" },
  { code: "CS3423", name: "Cấu trúc tập tin" },
  { code: "CS3443", name: "Hệ thống máy tính" },
  { code: "CS351", name: "Chuyên đề NCKH 1" },
  { code: "CS3513", name: "Phương pháp số cho máy tính kỹ thuật số" },
  { code: "CS352", name: "Chuyên đề NCKH 2" },
  { code: "CS3613", name: "Cơ sở tính toán" },
  { code: "CS3653", name: "Toán rời rạc" },
  { code: "CS371", name: "Seminar chuyên đề 1" },
  { code: "CS372", name: "Seminar chuyên đề 2" },
  { code: "CS401", name: "Công nghệ Java" },
  { code: "CS402", name: "Phân tích thiết kế HTTT quản lý" },
  { code: "CS403", name: "Các dịch vụ web" },
  { code: "CS404", name: "Công nghệ đa tác tử (Muli-Agent)" },
  { code: "CS405", name: "Logic mờ và ứng dụng" },
  { code: "CS406", name: "Xử lý ảnh và ứng dụng" },
  { code: "CS407", name: "Các kỹ thuật trong xử lý NNTN" },
  { code: "CS408", name: "Các hệ giải toán thông minh" },
  { code: "CS409", name: "Hệ suy diễn mờ" },
  { code: "CS410", name: "Mạng neural và thuật giải di truyền" },
  { code: "CS411", name: "Dịch máy" },
  { code: "CS412", name: "Web ngữ nghĩa" },
  { code: "CS414", name: "Lý thuyết automat và ứng dụng" },
  { code: "CS4143", name: "Đồ họa máy tính" },
  { code: "CS415", name: "Mã hóa thông tin" },
  { code: "CS4153", name: "Phát triển ứng dụng trên di động" },
  { code: "CS417", name: "Nhận dạng" },
  { code: "CS418", name: "Trực quan máy tính" },
  { code: "CS419", name: "Truy xuất thông tin" },
  { code: "CS420", name: "Các vấn đề chọn lọc trong thị giác máy tính" },
  { code: "CS421", name: "Khai thác dữ liệu đa phương tiện" },
  { code: "CS4243", name: "Thuật toán và tiến trình trong an toàn máy tính" },
  { code: "CS4273", name: "Nhập môn Công nghệ phần mềm" },
  { code: "CS4283", name: "Mạng máy tính" },
  { code: "CS431", name: "Các kĩ thuật học sâu và ứng dụng" },
  { code: "CS4323", name: "Hệ điều hành" },
  { code: "CS4343", name: "Cấu trúc dữ liệu và giải thuật" },
  { code: "CS4344", name: "An ninh mạng" },
  { code: "CS4793", name: "Trí tuệ nhân tạo" },
  { code: "CS4883", name: "Các vấn đề xã hội trong tính toán" },
  { code: "CS5000", name: "Luận văn" },
  { code: "CS501", name: "Khóa luận tốt nghiệp" },
  { code: "CS502", name: "Các công nghệ web và ứng dụng" },
  { code: "CS503", name: "Môn tốt nghiệp KHMT 2" },
  { code: "CS5030", name: "Thực tập tốt nghiệp" },
  { code: "CS5031", name: "Thực tập doanh nghiệp" },
  { code: "CS504", name: "Công nghệ .NET" },
  { code: "CS505", name: "Khoá luận tốt nghiệp" },
  { code: "CS506", name: "Chuyên đề J2EE" },
  { code: "CS507", name: "Hệ điều hành Linux" },
  { code: "CS508", name: "Lập trình cơ sở dữ liệu" },
  { code: "CS510", name: "Lý thuyết thông tin" },
  { code: "CS511", name: "Ngôn ngữ lập trình C#" },
  { code: "CS513", name: "Ngôn ngữ lập trình Java" },
  { code: "CS515", name: "Phân tích thiết kế hệ thống thông tin" },
  { code: "CS516", name: "Phân tích thiết kế hướng đối tượng với UML" },
  { code: "CS517", name: "Quản lý dự án" },
  { code: "CS518", name: "Xây dựng phần mềm hướng đối tượng" },
  { code: "CS519", name: "Phương pháp luận nghiên cứu khoa học" },
  { code: "CS521", name: "Toán rời rạc nâng cao" },
  { code: "CS522", name: "Đại số máy tính" },
  { code: "CS523", name: "Cấu trúc dữ liệu và giải thuật nâng cao" },
  { code: "CS524", name: "Một số ứng dụng của xử lý ngôn ngữ tự nhiên" },
  { code: "CS525", name: "Thị giác máy tính trong tương tác người – máy" },
  { code: "CS526", name: "Phát triển ứng dụng đa phương tiện trên thiết bị di động" },
  { code: "CS527", name: "Thực tại ảo" },
  { code: "CS528", name: "Trực quan hóa thông tin" },
  { code: "CS529", name: "Các vấn đề nghiên cứu và ứng dụng trong khoa học máy tính" },
  { code: "CS530", name: "Đồ án chuyên ngành" },
  { code: "CS531", name: "Đồ họa trong video game" },
  { code: "CS532", name: "Thị giác máy tính trong tương tác người-máy" },
  { code: "CS534", name: "Lập trình Javascript và ứng dụng" },
  { code: "CS535", name: "Tổng hợp tiếng nói" },
  { code: "CS5423", name: "Nguyên lý các hệ cơ sở dữ liệu" },
  { code: "CS5433", name: "Các hệ cơ sở dữ liệu phân tán" },
  { code: "CS551", name: "Thực tập" },
  { code: "CS553", name: "Đồ án tốt nghiệp" },
  { code: "CS554", name: "Đồ án tốt nghiệp tại doanh nghiệp" },
  { code: "CSBU001", name: "Lập trình" },
  { code: "CSBU002", name: "Mạng máy tính" },
  { code: "CSBU003", name: "Thực hành nghề nghiệp" },
  { code: "CSBU004", name: "Toán cho tin học" },
  { code: "CSBU005", name: "Bảo mật" },
  { code: "CSBU006", name: "Quản lý dự án máy tính thành công" },
  { code: "CSBU007", name: "Thiết kế và phát triển cơ sở dữ liệu" },
  { code: "CSBU008", name: "Kiến trúc máy tính" },
  { code: "CSBU009", name: "Dự án nghiên cứu" },
  { code: "CSBU010", name: "Công nghệ kinh doanh thông minh" },
  { code: "CSBU011", name: "Toán rời rạc" },
  { code: "CSBU012", name: "Cấu trúc dữ liệu và giải thuật" },
  { code: "CSBU013", name: "Lập trình nâng cao" },
  { code: "CSBU014", name: "Máy học" },
  { code: "CSBU015", name: "Điện toán đám mây" },
  { code: "CSBU016", name: "Thực tập" },
  { code: "CSBU101", name: "Lập trình máy tính" },
  { code: "CSBU102", name: "Hệ thống máy tính" },
  { code: "CSBU103", name: "Phát triển và thiết kế web" },
  { code: "CSBU104", name: "Cấu trúc dữ liệu và giải thuật" },
  { code: "CSBU105", name: "Mạng máy tính căn bản" },
  { code: "CSBU106", name: "Đồ án đổi mới sáng tạo" },
  { code: "CSBU107", name: "Lập trình hướng đối tượng" },
  { code: "CSBU108", name: "Hệ điều hành" },
  { code: "CSBU109", name: "Phát triển ứng dụng web và cơ sở dữ liệu" },
  { code: "CSBU110", name: "Toán rời rạc và lập trình khai báo" },
  { code: "CSBU111", name: "An ninh mạng" },
  { code: "CSBU112", name: "Thiết kế phần mềm" },
  { code: "CSBU201", name: "Thiết kế trải nghiệm người dùng" },
  { code: "CSBU202", name: "Phát triển ứng dụng cho thiết bị di động và thiết bị đeo" },
  { code: "CSBU203", name: "Điện toán đám mây" },
  { code: "CSBU204", name: "Trí tuệ nhân tạo và máy học" },
  { code: "CSBU205", name: "Dự án cá nhân" },
  { code: "CSC01", name: "Tin học đại cương" },
  { code: "CSC11", name: "Khoa học máy tính I" },
  { code: "CSC12", name: "Khoa học máy tính II" },
  { code: "CSC21", name: "Tin học đại cương (TE)" },
  { code: "CSKI1", name: "Kỹ năng truyền thông làm việc nhóm" },
  { code: "CU001", name: "Văn hóa doanh nghiệp Nhật" },
  { code: "DAI015", name: "Thực hành văn bản Tiếng Việt" },
  { code: "DBSS0", name: "Cơ sở dữ liệu" },
  { code: "DBSS1", name: "Cơ sở dữ liệu" },
  { code: "DS005", name: "Giới thiệu ngành Khoa học Dữ liệu" },
  { code: "DS101", name: "Thống kê và xác suất chuyên sâu" },
  { code: "DS102", name: "Học máy thống kê" },
  { code: "DS103", name: "Thu thập và tiền xử lý dữ liệu" },
  { code: "DS104", name: "Tính toán song song và phân tán" },
  { code: "DS105", name: "Phân tích và trực quan dữ liệu" },
  { code: "DS106", name: "Tối ưu hóa và ứng dụng" },
  { code: "DS107", name: "Tư duy tính toán cho khoa học dữ liệu" },
  { code: "DS108", name: "Tiền xử lý và xây dựng bộ dữ liệu" },
  { code: "DS111", name: "Phân tích dữ liệu" },
  { code: "DS200", name: "Phân tích dữ liệu lớn" },
  { code: "DS201", name: "Deep Learning trong khoa học dữ liệu" },
  { code: "DS202", name: "Đồ án khoa học dữ liệu và ứng dụng 1" },
  { code: "DS203", name: "Đồ án khoa học dữ liệu và ứng dụng 2" },
  { code: "DS204", name: "Đồ án khoa học dữ liệu và ứng dụng" },
  { code: "DS207", name: "Đồ án" },
  { code: "DS300", name: "Hệ khuyến nghị" },
  { code: "DS301", name: "Các giải thuật khai phá dữ liệu lớn" },
  { code: "DS302", name: "Phân tích thống kê đa biến" },
  { code: "DS303", name: "Thống kê Bayes" },
  { code: "DS304", name: "Thiết kế và phân tích thực nghiệm" },
  { code: "DS305", name: "Phân tích dữ liệu chuỗi thời gian và ứng dụng" },
  { code: "DS306", name: "Phân tích dữ liệu lớn trong tài chính" },
  { code: "DS307", name: "Phân tích dữ liệu truyền thông xã hội" },
  { code: "DS308", name: "Mô hình đồ thị xác suất" },
  { code: "DS309", name: "Thực tập doanh nghiệp" },
  { code: "DS310", name: "Xử lý ngôn ngữ tự nhiên cho khoa học dữ liệu" },
  { code: "DS311", name: "Kỹ năng nghiên cứu và viết bài báo khoa học" },
  { code: "DS312", name: "Xử lý ảnh y khoa" },
  { code: "DS313", name: "Xử lý thông tin giọng nói" },
  { code: "DS314", name: "Rút trích và truy vấn thông tin" },
  { code: "DS315", name: "Phân tích kho dữ liệu" },
  { code: "DS316", name: "Xây dựng ứng dụng thông minh" },
  { code: "DS317", name: "Khai phá dữ liệu trong doanh nghiệp" },
  { code: "DS318", name: "Đạo đức trong trí tuệ nhân tạo và khoa học dữ liệu" },
  { code: "DS319", name: "Mô hình ngôn ngữ lớn" },
  { code: "DS320", name: "Học đa thể thức" },
  { code: "DS321", name: "Khoa học dữ liệu cho an toàn thông tin" },
  { code: "DS322", name: "Thiết kế hệ thống học máy" },
  { code: "DS323", name: "Viết báo cáo kỹ thuật và thuyết trình" },
  { code: "DS324", name: "Khai thác dữ liệu ảnh số" },
  { code: "DS325", name: "Thiết kế ứng dụng với dữ liệu chuyên sâu" },
  { code: "DS326", name: "Khai phá dữ liệu đa phương tiện và ứng dụng" },
  { code: "DS327", name: "Các mô hình nền tảng" },
  { code: "DS400", name: "Chuyên đề tốt nghiệp khoa học dữ liệu" },
  { code: "DS501", name: "Đồ án tốt nghiệp" },
  { code: "DS502", name: "Đồ án tốt nghiệp tại doanh nghiệp" },
  { code: "DS505", name: "Khóa luận tốt nghiệp" },
  { code: "DSAL0", name: "Cấu trúc dữ liệu và giải thuật" },
  { code: "DSAL1", name: "Cấu trúc dữ liệu và giải thuật" },
  { code: "DSAL2", name: "Cấu trúc dữ liệu & giải thuật nâng cao" },
  { code: "DTH039", name: "Đô thị học đại cương" },
  { code: "EC001", name: "Kinh tế học đại cương" },
  { code: "EC002", name: "Quản trị doanh nghiệp" },
  { code: "EC003", name: "Tiếp thị căn bản" },
  { code: "EC005", name: "Giới thiệu ngành Thương mại Điện tử" },
  { code: "EC101", name: "Marketing căn bản" },
  { code: "EC201", name: "Phân tích thiết kế quy trình nghiệp vụ doanh nghiệp" },
  { code: "EC202", name: "Nhập môn quản trị chuỗi cung ứng" },
  { code: "EC203", name: "Quản trị quan hệ khách hàng và nhà cung cấp" },
  { code: "EC204", name: "Marketing điện tử" },
  { code: "EC208", name: "Quản trị dự án thương mại điện tử" },
  { code: "EC212", name: "Thực tập doanh nghiệp" },
  { code: "EC213", name: "Quản trị quan hệ khách hàng và nhà cung cấp" },
  { code: "EC214", name: "Nhập môn quản trị chuỗi cung ứng" },
  { code: "EC219", name: "Pháp luật trong thương mại điện tử" },
  { code: "EC222", name: "Thực tập doanh nghiệp" },
  { code: "EC229", name: "Pháp luật trong thương mại điện tử" },
  { code: "EC232", name: "Nguyên lý kế toán" },
  { code: "EC301", name: "Tiếp thị trực tuyến (E-Marketing)" },
  { code: "EC302", name: "Thiết kế Hệ thống Thương mại điện tử" },
  { code: "EC304", name: "Tối ưu hóa công cụ tìm kiếm trong thương mại điện tử" },
  { code: "EC311", name: "Tiếp thị trực tuyến" },
  { code: "EC312", name: "Thiết kế hệ thống thương mại điện tử" },
  { code: "EC331", name: "Quản trị chiến lược kinh doanh điện tử" },
  { code: "EC332", name: "Quản trị sản xuất" },
  { code: "EC333", name: "Quản trị tài chính doanh nghiệp" },
  { code: "EC334", name: "Quản trị kênh phân phối" },
  { code: "EC335", name: "An toàn và bảo mật thương mại điện tử" },
  { code: "EC336", name: "Quản trị nhân lực" },
  { code: "EC337", name: "Hệ thống thanh toán trực tuyến" },
  { code: "EC338", name: "Quản trị bán hàng" },
  { code: "EC401", name: "Khóa luận tốt nghiệp" },
  { code: "EC402", name: "Phát triển ứng dụng thương mại di động" },
  { code: "EC403", name: "Thương mại xã hội" },
  { code: "EC404", name: "Đồ án tốt nghiệp" },
  { code: "EC405", name: "Đồ án tốt nghiệp tại doanh nghiệp" },
  { code: "ECE02", name: "Mạch số" },
  { code: "ECON3313", name: "Kinh tế tiền tệ" },
  { code: "EN001", name: "Anh văn 1" },
  { code: "EN001.CO", name: "English for Communication 1" },
  { code: "EN001.GE", name: "General English" },
  { code: "EN002", name: "Anh văn 2" },
  { code: "EN002.CO", name: "English for Communication 1" },
  { code: "EN002.GE", name: "General English" },
  { code: "EN003", name: "Anh văn 3" },
  { code: "EN004", name: "Anh văn 1" },
  { code: "EN005", name: "Anh văn 2" },
  { code: "EN006", name: "Anh văn 3" },
  { code: "ENBT", name: "Anh văn Bổ túc" },
  { code: "ENG00", name: "Anh văn 0" },
  { code: "ENG01", name: "Anh văn 1" },
  { code: "ENG02", name: "Anh văn 2" },
  { code: "ENG03", name: "Anh văn 3" },
  { code: "ENG04", name: "Anh văn 4" },
  { code: "ENG05", name: "Anh văn 5" },
  { code: "ENG06", name: "Kỹ năng thuyết trình tiếng Anh" },
  { code: "ENG07", name: "Kỹ năng viết luận" },
  { code: "ENG11", name: "Tiếng anh tăng cường I" },
  { code: "ENG12", name: "Tiếng anh tăng cường II" },
  { code: "ENG13", name: "Tiếng Anh I" },
  { code: "ENG14", name: "Tiếng Anh II" },
  { code: "ENG15", name: "Tiếng Anh chuyên ngành CNTT" },
  { code: "ENGA1", name: "Anh văn sơ cấp 1" },
  { code: "ENGA2", name: "Anh văn sơ cấp 2" },
  { code: "ENGBT", name: "Anh văn bổ túc" },
  { code: "ENGL1113", name: "Tiếng Anh 1" },
  { code: "ENGL1213", name: "Tiếng Anh 2" },
  { code: "ENLS1", name: "Nâng cao kỹ năng nghe, nói tiếng Anh 1" },
  { code: "ENLS2", name: "Nâng cao kỹ năng nghe, nói tiếng Anh 2" },
  { code: "ENRW1", name: "Nâng cao kỹ năng đọc, viết tiếng Anh 1" },
  { code: "ENRW2", name: "Nâng cao kỹ năng đọc, viết tiếng Anh 2" },
  { code: "GDH075", name: "Tâm lý học giao tiếp" },
  { code: "HCMT1", name: "Tư tưởng Hồ Chí Minh" },
  { code: "HCMT2", name: "Tư tưởng Hồ Chí Minh" },
  { code: "IE005", name: "Giới thiệu ngành Công nghệ Thông tin" },
  { code: "IE101", name: "Cơ sở hạ tầng công nghệ thông tin" },
  { code: "IE102", name: "Các công nghệ nền" },
  { code: "IE103", name: "Quản lý thông tin" },
  { code: "IE104", name: "Internet và công nghệ web" },
  { code: "IE105", name: "Nhập môn bảo đảm và an ninh thông tin" },
  { code: "IE106", name: "Thiết kế giao diện người dùng" },
  { code: "IE107", name: "Thiết kế giao diện người dùng" },
  { code: "IE108", name: "Phân tích thiết kế phần mềm" },
  { code: "IE201", name: "Xử lý dữ liệu thống kê" },
  { code: "IE202", name: "Quản trị doanh nghiệp" },
  { code: "IE203", name: "Hệ thống quản trị qui trình nghiệp vụ" },
  { code: "IE204", name: "Tối ưu hóa công cụ tìm kiếm" },
  { code: "IE205", name: "Xử lý ảnh vệ tinh" },
  { code: "IE206", name: "Đồ án chuẩn bị tốt nghiệp" },
  { code: "IE207", name: "Đồ án" },
  { code: "IE208", name: "Kiến trúc và tích hợp hệ thống" },
  { code: "IE209", name: "Công nghệ Java" },
  { code: "IE210", name: "Hệ thống định vị toàn cầu (GPS)" },
  { code: "IE211", name: "Tin học môi trường" },
  { code: "IE212", name: "Công nghệ dữ liệu lớn" },
  { code: "IE213", name: "Kỹ thuật phát triển hệ thống web" },
  { code: "IE216", name: "Các chủ đề toán học cho khoa học dữ liệu" },
  { code: "IE217", name: "Máy học" },
  { code: "IE218", name: "Xử lý dữ liệu lớn" },
  { code: "IE221", name: "Kỹ thuật lập trình Python" },
  { code: "IE222", name: "Phân tích dữ liệu bằng Python" },
  { code: "IE223", name: "Phân tích dữ liệu bằng Python và R" },
  { code: "IE224", name: "Phân tích dữ liệu" },
  { code: "IE225", name: "Mạng kết nối" },
  { code: "IE226", name: "Đồ họa và trực quan hóa máy tính" },
  { code: "IE227", name: "Xử lý tín hiệu số cho mạng" },
  { code: "IE228", name: "Tương tác người-máy Việt Nhật" },
  { code: "IE229", name: "Trí tuệ nhân tạo Việt Nhật" },
  { code: "IE230", name: "Viết báo cáo kỹ thuật bằng tiếng Nhật" },
  { code: "IE231", name: "Quản trị doanh nghiệp công nghệ thông tin" },
  { code: "IE232", name: "Nhập môn trí tuệ nhân tạo" },
  { code: "IE233", name: "Phân tích và mô hình mạng xã hội" },
  { code: "IE301", name: "Quản trị quan hệ khách hàng" },
  { code: "IE302", name: "Kiến trúc và tích hợp hệ thống" },
  { code: "IE303", name: "Công nghệ Java" },
  { code: "IE304", name: "Hệ thống định vị toàn cầu" },
  { code: "IE305", name: "Tin học môi trường" },
  { code: "IE307", name: "Công nghệ lập trình đa nền tảng cho ứng dụng di động" },
  { code: "IE309", name: "Thực tập doanh nghiệp" },
  { code: "IE310", name: "Tư duy thiết kế" },
  { code: "IE313", name: "Phân tích và trực quan dữ liệu" },
  { code: "IE400", name: "Chuyên đề tốt nghiệp" },
  { code: "IE401", name: "Tin-Sinh học" },
  { code: "IE402", name: "Hệ thống thông tin địa lý 3 chiều" },
  { code: "IE403", name: "Khai thác dữ liệu truyền thông xã hội" },
  { code: "IE404", name: "Khai phá truyền thông xã hội" },
  { code: "IE405", name: "Công nghệ phân tích dữ liệu lớn" },
  { code: "IE406", name: "Nhập môn ẩn thông tin và ứng dụng" },
  { code: "IE501", name: "Đồ án tốt nghiệp" },
  { code: "IE502", name: "Đồ án tốt nghiệp tại doanh nghiệp" },
  { code: "IE505", name: "Khóa luận tốt nghiệp" },
  { code: "IEM4733", name: "Tái cấu trúc quy trình doanh nghiệp" },
  { code: "IEM5723", name: "Mô hình hóa dữ liệu, quy trình và đối tượng" },
  { code: "INI01", name: "Thực tập quốc tế" },
  { code: "INT001", name: "Tiếng Anh tổng quát" },
  { code: "INT002", name: "Toeic 1" },
  { code: "INT003", name: "Tiếng Anh tổng quát 2" },
  { code: "INT004", name: "Toeic 2" },
  { code: "INT005", name: "Tiếng Anh giao tiếp" },
  { code: "INT006", name: "Toeic 3" },
  { code: "IS005", name: "Giới thiệu ngành Hệ thống Thông tin" },
  { code: "IS101", name: "Thiết kế cơ sở dữ liệu" },
  { code: "IS102", name: "Các hệ cơ sở tri thức" },
  { code: "IS103", name: "Hệ quản trị cơ sở dữ liệu" },
  { code: "IS104", name: "Cơ sở dữ liệu phân tán" },
  { code: "IS105", name: "Hệ quản trị cơ sở dữ liệu Oracle" },
  { code: "IS106", name: "Khai thác dữ liệu" },
  { code: "IS107", name: "Hệ thống thông tin kế toán" },
  { code: "IS201", name: "Phân tích thiết kế hệ thống" },
  { code: "IS202", name: "Nhập môn công nghệ phần mềm" },
  { code: "IS203", name: "Lập trình cơ sở dữ liệu" },
  { code: "IS204", name: "Nhập môn hệ thống thông tin địa lý" },
  { code: "IS205", name: "PTTK hướng đối tượng với UML" },
  { code: "IS206", name: "Lập trình ứng dụng Web với Java" },
  { code: "IS207", name: "Phát triển ứng dụng web" },
  { code: "IS208", name: "Quản lý dự án công nghệ thông tin" },
  { code: "IS210", name: "Hệ quản trị cơ sở dữ liệu" },
  { code: "IS211", name: "Cơ sở dữ liệu phân tán" },
  { code: "IS212", name: "Thực tập tốt nghiệp" },
  { code: "IS213", name: "Đồ án xây dựng một hệ thống thông tin" },
  { code: "IS214", name: "Thiết kế cơ sở dữ liệu" },
  { code: "IS215", name: "Thiết kế hướng đối tượng với UML" },
  { code: "IS216", name: "Lập trình Java" },
  { code: "IS217", name: "Kho dữ liệu và OLAP" },
  { code: "IS218", name: "Kỹ năng tư vấn" },
  { code: "IS219", name: "Pháp luật trong Thương mại điện tử" },
  { code: "IS220", name: "Xây dựng hệ thống thông tin trên các framework" },
  { code: "IS225", name: "Khai thác dữ liệu và ứng dụng" },
  { code: "IS232", name: "Hệ thống thông tin kế toán" },
  { code: "IS251", name: "Nhập môn hệ thống thông tin địa lý" },
  { code: "IS252", name: "Khai thác dữ liệu" },
  { code: "IS253", name: "Lập trình ứng dụng trên thiết bị di động" },
  { code: "IS254", name: "Hệ hỗ trợ quyết định" },
  { code: "IS301", name: "Thương mại điện tử" },
  { code: "IS302", name: "Phân tích không gian" },
  { code: "IS303", name: "Hệ cơ sở dữ liệu không gian" },
  { code: "IS3033", name: "Quản lý dự án hệ thống thông tin" },
  { code: "IS304", name: "Kho dữ liệu và OLAP" },
  { code: "IS305", name: "An toàn và bảo mật HTTT" },
  { code: "IS306", name: "Hệ thống thông tin quản lý" },
  { code: "IS311", name: "Đồ án hệ thống thông tin" },
  { code: "IS3303", name: "Phân tích thiết kế hệ thống" },
  { code: "IS332", name: "Hệ thống thông tin quản lý" },
  { code: "IS334", name: "Thương mại điện tử" },
  { code: "IS335", name: "An toàn và bảo mật hệ thống thông tin" },
  { code: "IS336", name: "Hoạch định nguồn lực doanh nghiệp" },
  { code: "IS337", name: "Cơ sở dữ liệu nâng cao" },
  { code: "IS338", name: "Dự báo kinh doanh" },
  { code: "IS339", name: "Sinh tin học" },
  { code: "IS340", name: "Thị trường chứng khoán" },
  { code: "IS341", name: "Khởi nghiệp" },
  { code: "IS342", name: "Chính phủ điện tử" },
  { code: "IS343", name: "Luật CNTT" },
  { code: "IS344", name: "Quản trị nguồn lực y tế" },
  { code: "IS345", name: "AI trong y tế" },
  { code: "IS346", name: "Quản lý dự án công nghệ thông tin y tế" },
  { code: "IS347", name: "Thống kê y học" },
  { code: "IS348", name: "Dịch tễ học" },
  { code: "IS349", name: "Hệ thống y tế" },
  { code: "IS351", name: "Phân tích không gian" },
  { code: "IS352", name: "Hệ cơ sở dữ liệu không gian" },
  { code: "IS353", name: "Mạng xã hội" },
  { code: "IS354", name: "Công nghệ tài chính căn bản Fintech" },
  { code: "IS355", name: "Công nghệ Blockchain" },
  { code: "IS356", name: "Agile IT với DevOps" },
  { code: "IS357", name: "Kiến trúc hướng dịch vụ" },
  { code: "IS358", name: "Kiểm soát nhiễm khuẩn bệnh viện" },
  { code: "IS360", name: "Quản lý chăm sóc và điều trị" },
  { code: "IS361", name: "Quản lý chuỗi cung ứng dược và thiết bị y tế" },
  { code: "IS362", name: "Quản trị tài chính và bảo hiểm y tế" },
  { code: "IS363", name: "Pháp luật trong lĩnh vực y tế" },
  { code: "IS364", name: "Mã tiêu chuẩn dùng chung trong y tế" },
  { code: "IS401", name: "Khóa luận tốt nghiệp" },
  { code: "IS4013", name: "Thiết kế, quản lý và quản trị hệ CSDL" },
  { code: "IS402", name: "Điện toán đám mây" },
  { code: "IS403", name: "Phân tích dữ liệu kinh doanh" },
  { code: "IS404", name: "Kho dữ liệu và OLAP" },
  { code: "IS405", name: "Dữ liệu lớn" },
  { code: "IS406", name: "Điện toán đám mây và dữ liệu lớn" },
  { code: "IS407", name: "Đồ án tốt nghiệp" },
  { code: "IS4133", name: "Công nghệ thông tin cho thương mại điện tử" },
  { code: "IS4263", name: "Các ứng dụng thông minh và hỗ trợ ra quyết định" },
  { code: "IS4523", name: "Hệ truyền thông dữ liệu" },
  { code: "IS501", name: "Thực tập cuối khóa" },
  { code: "IS502", name: "Thực tập doanh nghiệp" },
  { code: "IS503", name: "Đồ án tốt nghiệp tại doanh nghiệp" },
  { code: "IS505", name: "Khóa luận tốt nghiệp" },
  { code: "IS5100", name: "Thực tập cuối khóa" },
  { code: "IS6301", name: "Phân tích thiết kế hệ thống thông tin nâng cao" },
  { code: "IT001", name: "Nhập môn lập trình" },
  { code: "IT002", name: "Lập trình hướng đối tượng" },
  { code: "IT003", name: "Cấu trúc dữ liệu và giải thuật" },
  { code: "IT004", name: "Cơ sở dữ liệu" },
  { code: "IT005", name: "Nhập môn mạng máy tính" },
  { code: "IT006", name: "Kiến trúc máy tính" },
  { code: "IT007", name: "Hệ điều hành" },
  { code: "IT008", name: "Lập trình trực quan" },
  { code: "IT009", name: "Giới thiệu ngành" },
  { code: "IT010", name: "Tổ chức và cấu trúc máy tính" },
  { code: "IT011", name: "Nhập môn lập trình thi đấu" },
  { code: "IT012", name: "Tổ chức và cấu trúc máy tính 2" },
  { code: "IT013", name: "Cấu trúc dữ liệu cho lập trình thi đấu" },
  { code: "ITEM1", name: "Nhập môn Quản trị doanh nghiệp" },
  { code: "ITEW1", name: "Nhập môn công tác kỹ sư" },
  { code: "ITNT005", name: "Communication" },
  { code: "2026-01-01 00:00:00", name: "Tiếng Nhật 1" },
  { code: "2026-01-02 00:00:00", name: "Tiếng Nhật 2" },
  { code: "2026-01-03 00:00:00", name: "Tiếng Nhật 3" },
  { code: "2026-01-04 00:00:00", name: "Tiếng Nhật 4" },
  { code: "2026-01-05 00:00:00", name: "Tiếng Nhật 5" },
  { code: "2026-01-06 00:00:00", name: "Tiếng Nhật 6" },
  { code: "2026-01-07 00:00:00", name: "Tiếng Nhật 7" },
  { code: "2026-01-08 00:00:00", name: "Tiếng Nhật 8" },
  { code: "JANHU", name: "Tiếng Nhật miễn phí do Huredee tài trợ" },
  { code: "LIA01", name: "Đại số tuyến tính" },
  { code: "LIA11", name: "Đại số tuyến tính" },
  { code: "MA001", name: "Giải tích 1" },
  { code: "MA002", name: "Giải tích 2" },
  { code: "MA003", name: "Đại số tuyến tính" },
  { code: "MA004", name: "Cấu trúc rời rạc" },
  { code: "MA005", name: "Xác suất thống kê" },
  { code: "MA006", name: "Giải tích" },
  { code: "MAT01", name: "Toán cao cấp A1" },
  { code: "MAT02", name: "Toán cao cấp A2" },
  { code: "MAT04", name: "Cấu trúc rời rạc" },
  { code: "MAT11", name: "Giải tích 1" },
  { code: "MAT12", name: "Giải tích 2" },
  { code: "MAT14", name: "Toán rời rạc cho máy tính" },
  { code: "MAT21", name: "Toán cao cấp A1 (TE)" },
  { code: "MAT22", name: "Toán cao cấp A2 (TE)" },
  { code: "MAT23", name: "Đại số tuyến tính" },
  { code: "MAT24", name: "Cấu trúc rời rạc (TE)" },
  { code: "MATH2144", name: "Giải tích 1" },
  { code: "MATH2153", name: "Giải tích 2" },
  { code: "MATH2154", name: "Giải tích" },
  { code: "MATH3013", name: "Đại số tuyến tính" },
  { code: "ME001", name: "Giáo dục quốc phòng" },
  { code: "MEDU1", name: "Giáo dục quốc phòng" },
  { code: "MKTG4223", name: "Quản trị chuỗi cung ứng" },
  { code: "MKTG5883", name: "Khai phá dữ liệu và ứng dụng" },
  { code: "MLPE1", name: "Kinh tế chính trị Mác-Lênin (TE)" },
  { code: "MLPE2", name: "Kinh tế chính trị Mác-Lênin (TE1)" },
  { code: "MM001", name: "Kỹ năng truyền thông cho người làm công nghệ thông tin" },
  { code: "MM002", name: "Truyền thông kỹ thuật số" },
  { code: "MM003", name: "Quản trị sự kiện" },
  { code: "MM004", name: "Nguyên lý thiết kế đồ hoạ" },
  { code: "MM005", name: "Nhập môn marketing" },
  { code: "MM006", name: "Tâm lý học đại cương" },
  { code: "MM007", name: "Tư duy sáng tạo và xu hướng thiết kế truyền thông" },
  { code: "MM008", name: "Kỹ năng truyền thông ứng dụng" },
  { code: "MM101", name: "Giới thiệu ngành Truyền thông đa phương tiện" },
  { code: "MM102", name: "Lý luận truyền thông đại chúng" },
  { code: "MM103", name: "Cơ sở tạo hình và nguyên lý thị giác" },
  { code: "MM104", name: "Viết nội dung đa phương tiện" },
  { code: "MM105", name: "Nhập môn kỹ thuật sản xuất nội dung đa phương tiện" },
  { code: "MM106", name: "Thu thập và phân tích khám phá dữ liệu truyền thông đa phương tiện" },
  { code: "MM107", name: "Học máy ứng dụng trong truyền thông đa phương tiện" },
  { code: "MM108", name: "Tiếp thị số" },
  { code: "MM109", name: "Thiết kế đồ họa" },
  { code: "MM110", name: "Màu sắc và tâm lý thị giác trong thiết kế truyền thông" },
  { code: "MM201", name: "Truyền thông và dư luận xã hội" },
  { code: "MM202", name: "Học sâu ứng dụng trong truyền thông đa phương tiện" },
  { code: "MM203", name: "Xử lý ngôn ngữ tự nhiên cho truyền thông đa phương tiện" },
  { code: "MM204", name: "Xử lý ảnh số và video trong truyền thông đa phương tiện" },
  { code: "MM205", name: "Phân tích và hiểu nội dung đa phương thức" },
  { code: "MM206", name: "Dữ liệu lớn ứng dụng trong truyền thông đa phương tiện" },
  { code: "MM207", name: "Hệ thống khai phá dữ liệu mạng xã hội" },
  { code: "MM208", name: "Thiết kế và sản xuất ấn phẩm" },
  { code: "MM209", name: "Nghiệp vụ truyền thông và báo chí" },
  { code: "MM210", name: "Kỹ thuật quay phim biên kịch và hậu kỳ" },
  { code: "MM211", name: "Thực tế ảo và thực tế tăng cường" },
  { code: "MM212", name: "Hoạt hình" },
  { code: "MM213", name: "Quản lý dự án truyền thông đa phương tiện" },
  { code: "MM214", name: "Chiến lược phát triển thương hiệu" },
  { code: "MM215", name: "Quan hệ công chúng trong marketing" },
  { code: "MM216", name: "Tối ưu hóa và tiếp thị trên công cụ tìm kiếm" },
  { code: "MM217", name: "Tiếp thị cho sản phẩm dịch vụ" },
  { code: "MM218", name: "Xây dựng kênh tiếp thị trực tuyến" },
  { code: "MM219", name: "Quản trị mối quan hệ khách hàng định hướng dữ liệu" },
  { code: "MM220", name: "Phân tích dữ liệu truyền thông số" },
  { code: "MM221", name: "Chuyên đề các vấn đề hiện đại trong truyền thông đa phương tiện" },
  { code: "MM222", name: "An ninh thông tin trong truyền thông đa phương tiện" },
  { code: "MM223", name: "Kể chuyện tương tác" },
  { code: "MM224", name: "Hình họa cơ bản" },
  { code: "MM301", name: "Đồ án truyền thông đa phương tiện" },
  { code: "MM302", name: "Thực tập" },
  { code: "MM304", name: "Khởi nghiệp ngành Truyền thông đa phương tiện" },
  { code: "MM504", name: "Đồ án tốt nghiệp" },
  { code: "MM505", name: "Khóa luận tốt nghiệp" },
  { code: "MM506", name: "Đồ án tốt nghiệp tại doanh nghiệp" },
  { code: "MSIS207", name: "Phát triển ứng dụng web" },
  { code: "MSIS2433", name: "Lập trình hướng đối tượng" },
  { code: "MSIS3033", name: "Quản lý dự án hệ thống thông tin" },
  { code: "MSIS3233", name: "Khoa học quản lý" },
  { code: "MSIS3242", name: "Quản lý chất lượng phần mềm" },
  { code: "MSIS3243", name: "Lý thuyết quyết định quản lý" },
  { code: "MSIS3303", name: "Phân tích thiết kế hệ thống" },
  { code: "MSIS4013", name: "Thiết kế, quản lý và quản trị hệ cơ sở dữ liệu" },
  { code: "MSIS402", name: "Điện toán đám mây" },
  { code: "MSIS405", name: "Dữ liệu lớn" },
  { code: "MSIS406", name: "Dữ liệu lớn trên nền điện toán đám mây" },
  { code: "MSIS4133", name: "Công nghệ thông tin trong thương mại điện tử" },
  { code: "MSIS4243", name: "Điều khiển và giám sát hệ thống thông tin" },
  { code: "MSIS4263", name: "Các ứng dụng thông minh và hỗ trợ ra quyết định" },
  { code: "MSIS4363", name: "Các chủ đề nâng cao trong phát triển hệ thống" },
  { code: "MSIS4443", name: "Các hệ thống mô phỏng trên máy tính" },
  { code: "MSIS4523", name: "Hệ truyền thông dữ liệu" },
  { code: "MSIS4800", name: "Hệ thống thông tin tính toán" },
  { code: "MSIS4801", name: "Quản lý thông tin địa lý" },
  { code: "MSIS5723", name: "Phân tích thiết kế hệ thống thông tin" },
  { code: "NHJP1", name: "Tiếng Nhật Sơ cấp 1" },
  { code: "NHJP2", name: "Tiếng Nhật Sơ cấp 2" },
  { code: "NNH050", name: "Ngôn ngữ quảng cáo" },
  { code: "NT005", name: "Giới thiệu ngành Mạng máy tính và Truyền thông dữ liệu" },
  { code: "NT008", name: "Mạng truyền thông và di động" },
  { code: "NT009", name: "Lập trình ứng dụng Mạng" },
  { code: "NT015", name: "Giới thiệu ngành An toàn Thông tin" },
  { code: "NT101", name: "An toàn mạng máy tính" },
  { code: "NT102", name: "Điện tử cho công nghệ thông tin" },
  { code: "NT103", name: "Hệ điều hành Linux" },
  { code: "NT104", name: "Lý thuyết thông tin" },
  { code: "NT105", name: "Truyền dữ liệu" },
  { code: "NT106", name: "Lập trình mạng căn bản" },
  { code: "NT107", name: "Xử lý tín hiệu trong truyển thông" },
  { code: "NT108", name: "Mạng truyền thông và di động" },
  { code: "NT109", name: "Lập trình ứng dụng mạng" },
  { code: "NT110", name: "Tín hiệu và mạch" },
  { code: "NT111", name: "Thiết bị mạng và truyền thông ĐPT" },
  { code: "NT112", name: "Công nghệ mạng viễn thông" },
  { code: "NT113", name: "Thiết kế mạng" },
  { code: "NT114", name: "Đồ án chuyên ngành" },
  { code: "NT115", name: "Thực tập doanh nghiệp" },
  { code: "NT116", name: "Kỹ năng mềm" },
  { code: "NT117", name: "Đồ án môn học lập trình ứng dụng mạng" },
  { code: "NT118", name: "Phát triển ứng dụng trên thiết bị di động" },
  { code: "NT119", name: "Mật mã học" },
  { code: "NT121", name: "Thiết bị mạng và truyền thông đa phương tiện" },
  { code: "NT130", name: "Cơ chế hoạt động của mã độc" },
  { code: "NT131", name: "Hệ thống nhúng mạng không dây" },
  { code: "NT132", name: "Quản trị mạng và hệ thống" },
  { code: "NT133", name: "An toàn kiến trúc hệ thống" },
  { code: "NT137", name: "Kỹ thuật phân tích mã độc" },
  { code: "NT140", name: "An toàn mạng" },
  { code: "NT201", name: "Phân tích thiết kế hệ thống truyền thông và mạng" },
  { code: "NT202", name: "Đồ án môn Lập trình ứng dụng mạng" },
  { code: "NT203", name: "Đồ án chuyên ngành" },
  { code: "NT204", name: "Hệ thống tìm kiếm, phát hiện và ngăn ngừa xâm nhập" },
  { code: "NT205", name: "Tấn công mạng" },
  { code: "NT206", name: "Quản trị hệ thống mạng" },
  { code: "NT207", name: "Quản lý rủi ro và an toàn thông tin trong doanh nghiệp" },
  { code: "NT208", name: "Lập trình ứng dụng web" },
  { code: "NT209", name: "Lập trình hệ thống" },
  { code: "NT210", name: "Thương mại điện tử và triển khai ứng dụng" },
  { code: "NT211", name: "An ninh nhân sự, định danh và chứng thực" },
  { code: "NT212", name: "An toàn dữ liệu, khôi phục thông tin sau sự cố" },
  { code: "NT213", name: "Bảo mật web và ứng dụng" },
  { code: "NT215", name: "Thực tập doanh nghiệp" },
  { code: "NT216", name: "Bảo mật hệ thống dữ liệu" },
  { code: "NT219", name: "Mật mã học" },
  { code: "NT230", name: "Cơ chế hoạt động của mã độc" },
  { code: "NT301", name: "Quản trị hệ thống mạng" },
  { code: "NT302", name: "Xây dựng chuẩn chính sách an toàn thông tin trong doanh nghiệp" },
  { code: "NT303", name: "Công nghệ thoại IP" },
  { code: "NT304", name: "Ứng dụng truyền thông và an ninh thông tin" },
  { code: "NT305", name: "Phát triển ứng dụng trên thiết bị di động" },
  { code: "NT306", name: "Kỹ thuật lập trình mạng trên Linux" },
  { code: "NT307", name: "Xây dựng ứng dụng web" },
  { code: "NT309", name: "Lập trình trên Linux" },
  { code: "NT310", name: "Pháp chứng mạng di động" },
  { code: "NT311", name: "Công nghệ tường lửa và bảo vệ mạng ngoại vi" },
  { code: "NT312", name: "Bảo mật với smartcard và NFC" },
  { code: "NT320", name: "Công nghệ vệ tinh" },
  { code: "NT321", name: "Hệ thống tìm kiếm, phát hiện và ngăn ngừa xâm nhập" },
  { code: "NT330", name: "An toàn mạng không dây và di động" },
  { code: "NT331", name: "Xây dựng chuẩn chính sách an toàn thông tin trong doanh nghiệp" },
  { code: "NT332", name: "Xử lý tín hiệu trong truyền thông" },
  { code: "NT333", name: "Tính toán lưới" },
  { code: "NT334", name: "Pháp chứng kỹ thuật số" },
  { code: "NT395", name: "Phát triển ứng dụng trên thiết bị di động" },
  { code: "NT400", name: "An toàn mạng nâng cao" },
  { code: "NT401", name: "An toàn mạng nâng cao" },
  { code: "NT402", name: "Công nghệ mạng viễn thông" },
  { code: "NT403", name: "Tính toán lưới" },
  { code: "NT404", name: "Khóa luận tốt nghiệp" },
  { code: "NT405", name: "Bảo mật Internet" },
  { code: "NT406", name: "Đồ án tốt nghiệp" },
  { code: "NT407", name: "Pháp chứng kỹ thuật số" },
  { code: "NT408", name: "Bảo mật trên Internet" },
  { code: "NT501", name: "Thực tập doanh nghiệp" },
  { code: "NT502", name: "Thương mại Điện tử và Triển khai ứng dụng" },
  { code: "NT503", name: "Bảo mật Internet" },
  { code: "NT504", name: "Tiểu luận tốt nghiệp" },
  { code: "NT505", name: "Khóa luận tốt nghiệp" },
  { code: "NT506", name: "Đồ án tốt nghiệp tại doanh nghiệp" },
  { code: "NT507", name: "Xây dựng ứng dụng web" },
  { code: "NT508", name: "Đồ án tốt nghiệp" },
  { code: "NT509", name: "Hệ thống đa tác tử di động thông minh" },
  { code: "NT521", name: "Lập trình an toàn và khai thác lỗ hổng phần mềm" },
  { code: "NT522", name: "Phương pháp học máy trong an toàn thông tin" },
  { code: "NT523", name: "An toàn thông tin trong kỷ nguyên máy tính lượng tử" },
  { code: "NT524", name: "Kiến trúc và bảo mật điện toán đám mây" },
  { code: "NT531", name: "Đánh giá hiệu năng hệ thống mạng máy tính" },
  { code: "NT532", name: "Công nghệ Internet of things hiện đại" },
  { code: "NT533", name: "Hệ tính toán phân bố" },
  { code: "NT534", name: "An toàn mạng máy tính nâng cao" },
  { code: "NT535", name: "Bảo mật Internet of things" },
  { code: "NT536", name: "Công nghệ truyền thông đa phương tiện" },
  { code: "NT537", name: "Truyền thông xã hội và kinh doanh" },
  { code: "NT538", name: "Giải thuật xử lý song song và phân bố" },
  { code: "NT539", name: "AI ứng dụng trong mạng và truyền thông" },
  { code: "NT540", name: "Mạng không dây thế hệ mới" },
  { code: "NT541", name: "Công nghệ mạng khả lập trình" },
  { code: "NT542", name: "Lập trình kịch bản tự động hóa cho quản trị và bảo mật mạng" },
  { code: "NT543", name: "Tín hiệu và hệ thống thông tin" },
  { code: "NT544", name: "Ăng ten và truyền thông vô tuyến" },
  { code: "NT545", name: "Thiết kế hệ thống viễn thông" },
  { code: "NT546", name: "Thiết kế và triển khai mạng tốc độ cao" },
  { code: "NT547", name: "Blockchain: Nền tảng, ứng dụng và bảo mật" },
  { code: "NT548", name: "Công nghệ DevOps và ứng dụng" },
  { code: "NT549", name: "Học máy tăng cường cho các hệ thống mạng" },
  { code: "OOPT1", name: "Lập trình hướng đối tượng" },
  { code: "OOPT2", name: "Lập trình hướng đối tượng" },
  { code: "OSYS1", name: "Hệ điều hành" },
  { code: "OSYS2", name: "Hệ điều hành" },
  { code: "OSYS3", name: "Hệ điều hành" },
  { code: "PE001", name: "Giáo dục thể chất 1" },
  { code: "PE002", name: "Giáo dục thể chất 2" },
  { code: "PE003", name: "Giáo dục thể chất 3" },
  { code: "PE012", name: "Giáo dục thể chất" },
  { code: "PE231", name: "Giáo dục thể chất 1" },
  { code: "PE232", name: "Giáo dục thể chất 2" },
  { code: "PEDU1", name: "Giáo dục thể chất 1" },
  { code: "PEDU2", name: "Giáo dục thể chất 2" },
  { code: "PH001", name: "Nhập môn điện tử" },
  { code: "PH002", name: "Nhập môn mạch số" },
  { code: "PH003", name: "Vật lý kỹ thuật" },
  { code: "PHIL1", name: "Những NLCB của chủ nghĩa Mác-Lênin" },
  { code: "PHIL2", name: "Triết học Mác-Lênin" },
  { code: "PHY01", name: "Vật lý đại cương A1" },
  { code: "PHY02", name: "Vật lý đại cương A2" },
  { code: "PHY03", name: "Vật lý đại cương A3" },
  { code: "PHY11", name: "General Physics 1" },
  { code: "PHY12", name: "General Physics 2" },
  { code: "PHY22", name: "Vật lý đại cương A2 (TE1)" },
  { code: "PHYS1114", name: "Vật lý đại cương 1" },
  { code: "PHYS1214", name: "Vật lý đại cương 2" },
  { code: "PHYS1215", name: "Vật lý đại cương" },
  { code: "QTE111", name: "Văn hóa giao tiếp" },
  { code: "SC203", name: "Phương pháp nghiên cứu khoa học" },
  { code: "SE005", name: "Giới thiệu ngành Kỹ thuật Phần mềm" },
  { code: "SE100", name: "Phương pháp phát triển phần mềm hướng đối tượng" },
  { code: "SE101", name: "Phương pháp mô hình hóa" },
  { code: "SE102", name: "Nhập môn phát triển game" },
  { code: "SE103", name: "Các phương pháp lập trình" },
  { code: "SE104", name: "Nhập môn Công nghệ phần mềm" },
  { code: "SE105", name: "Lập trình nhúng căn bản" },
  { code: "SE106", name: "Đặc tả hình thức" },
  { code: "SE107", name: "Phân tích thiết kế hệ thống" },
  { code: "SE108", name: "Kiểm chứng phần mềm" },
  { code: "SE109", name: "Phát triển, vận hành, bảo trì phần mềm" },
  { code: "SE110", name: "Phương pháp Phát triển phần mềm hướng đối tượng" },
  { code: "SE111", name: "Đồ án mã nguồn mở" },
  { code: "SE112", name: "Đồ án chuyên ngành" },
  { code: "SE113", name: "Kiểm chứng phần mềm" },
  { code: "SE114", name: "Nhập môn ứng dụng di động" },
  { code: "SE115", name: "Phát triển game với Unity" },
  { code: "SE116", name: "Phát triển kỹ năng lập trình game ứng dụng trong thực tế" },
  { code: "SE117", name: "Kỹ thuật lập trình" },
  { code: "SE121", name: "Đồ án 1" },
  { code: "SE122", name: "Đồ án 2" },
  { code: "SE207", name: "Phân tích thiết kế hệ thống" },
  { code: "SE208", name: "Kiểm chứng phần mềm" },
  { code: "SE209", name: "Phát triển, vận hành, bảo trì phần mềm" },
  { code: "SE210", name: "Quản lý dự án công nghệ thông tin" },
  { code: "SE211", name: "Phát triển phần mềm hướng đối tượng" },
  { code: "SE212", name: "Phát triển phần mềm mã nguồn mở" },
  { code: "SE213", name: "Xử lý phân bố" },
  { code: "SE214", name: "Công nghệ phần mềm chuyên sâu" },
  { code: "SE215", name: "Giao tiếp người máy" },
  { code: "SE220", name: "Thiết kế game" },
  { code: "SE221", name: "Lập trình game nâng cao" },
  { code: "SE301", name: "Phát triển phần mềm mã nguồn mở" },
  { code: "SE310", name: "Công nghệ .NET" },
  { code: "SE311", name: "Ngôn ngữ lập trình Java" },
  { code: "SE312", name: "Công nghệ .NET" },
  { code: "SE313", name: "Một số thuật toán thông minh" },
  { code: "SE314", name: "Công nghệ game 3D" },
  { code: "SE315", name: "Công nghệ game online" },
  { code: "SE316", name: "Phát triển game đa nền tảng" },
  { code: "SE317", name: "Công nghệ tiên tiến trong phát triển game" },
  { code: "SE320", name: "Lập trình đồ họa 3 chiều với Direct3D" },
  { code: "SE321", name: "Lập trình trên thiết bị di động" },
  { code: "SE322", name: "Công nghệ Web và ứng dụng" },
  { code: "SE323", name: "Thiết kế Game" },
  { code: "SE324", name: "Nhập môn lập trình 3D game" },
  { code: "SE325", name: "Chuyên đề J2EE" },
  { code: "SE326", name: "Cơ sở dữ liệu nâng cao" },
  { code: "SE327", name: "Phát triển và vận hành game" },
  { code: "SE328", name: "Lập trình trí tuệ nhân tạo trong game" },
  { code: "SE329", name: "Thiết kế 3D Game Engine" },
  { code: "SE330", name: "Ngôn ngữ lập trình Java" },
  { code: "SE331", name: "Chuyên đề E-commerce" },
  { code: "SE332", name: "Chuyên đề cơ sở dữ liệu nâng cao" },
  { code: "SE333", name: "Chuyên đề E-Government" },
  { code: "SE334", name: "Các phương pháp lập trình" },
  { code: "SE335", name: "Công nghệ XML và ứng dụng" },
  { code: "SE336", name: "Phương pháp luận sáng tạo KH-CN" },
  { code: "SE337", name: "Các thuật toán thông minh" },
  { code: "SE338", name: "Logic mờ" },
  { code: "SE339", name: "Xử lý phân bổ" },
  { code: "SE340", name: "Quản lý dự án công nghệ thông tin" },
  { code: "SE341", name: "Công nghệ Web và ứng dụng" },
  { code: "SE342", name: "Logic mờ" },
  { code: "SE343", name: "Công nghệ Portal" },
  { code: "SE344", name: "Lập trình game trong các thiết bị di động" },
  { code: "SE345", name: "Kỹ thuật lập trình nhúng" },
  { code: "SE346", name: "Lập trình trên thiết bị di động" },
  { code: "SE347", name: "Công nghệ web và ứng dụng" },
  { code: "SE348", name: "Chuyên đề M-commerce" },
  { code: "SE349", name: "Nhập môn Quản trị doanh nghiệp" },
  { code: "SE350", name: "Chuyên đề E-learning" },
  { code: "SE351", name: "Xử lý song song" },
  { code: "SE352", name: "Phát triển ứng dụng VR" },
  { code: "SE354", name: "Chuyên đề các quy trình phát triển phần mềm hiện đại" },
  { code: "SE355", name: "Máy học và các công cụ" },
  { code: "SE356", name: "Kiến trúc phần mềm" },
  { code: "SE357", name: "Kỹ thuật phân tích yêu cầu" },
  { code: "SE358", name: "Quản lý dự án phát triển phần mềm" },
  { code: "SE359", name: "DevOps trong phát triển phần mềm" },
  { code: "SE360", name: "Điện toán đám mây và phát triển ứng dụng hướng dịch vụ" },
  { code: "SE361", name: "Phát triển phần mềm theo kiến trúc Microservices" },
  { code: "SE362", name: "An toàn phần mềm và hệ thống" },
  { code: "SE363", name: "Phát triển ứng dụng trên nền tảng dữ liệu lớn" },
  { code: "SE364", name: "Thiết kế giao diện và trải nghiệm người dùng" },
  { code: "SE365", name: "Học sâu ứng dụng trong phát triển phần mềm" },
  { code: "SE400", name: "Seminar các vấn đề hiện đại của công nghệ phần mềm" },
  { code: "SE401", name: "Mẫu thiết kế" },
  { code: "SE402", name: "Điện toán đám mây" },
  { code: "SE403", name: "Nguyên lý thiết kế thế giới ảo" },
  { code: "SE404", name: "Chuyên đề E-Government" },
  { code: "SE405", name: "Chuyên đề mobile and pervasive computing" },
  { code: "SE406", name: "Mẫu thiết kế hướng đối tượng" },
  { code: "SE407", name: "Chuyên đề pervasive and mobile computing" },
  { code: "SE408", name: "Phát triển game với blockchain" },
  { code: "SE409", name: "Phát triển dự án game" },
  { code: "SE417", name: "Đồ án môn học mã nguồn mở" },
  { code: "SE418", name: "Đồ án môn học chuyên ngành" },
  { code: "SE501", name: "Thực tập tốt nghiệp" },
  { code: "SE502", name: "Thực tập" },
  { code: "SE503", name: "Đồ án" },
  { code: "SE505", name: "Khóa luận tốt nghiệp" },
  { code: "SE506", name: "Đồ án tốt nghiệp tại doanh nghiệp" },
  { code: "SE507", name: "Đồ án tốt nghiệp" },
  { code: "SMET1", name: "Phương pháp NCKH trong tin học" },
  { code: "SMET2", name: "Phương pháp luận sáng tạo KH-CN" },
  { code: "SOCI1", name: "Chủ nghĩa xã hội khoa học" },
  { code: "SP3724", name: "Kỹ năng giao tiếp" },
  { code: "SPCH2713", name: "Kỹ năng giao tiếp" },
  { code: "SPCH3723", name: "Tiếng Anh chuyên ngành công nghệ thông tin" },
  { code: "SPCH3724", name: "Kỹ năng giao tiếp" },
  { code: "SS001", name: "Những nguyên lý cơ bản của chủ nghĩa Mác Lênin" },
  { code: "SS002", name: "Đường lối cách mạng của Đảng CS Việt Nam" },
  { code: "SS003", name: "Tư tưởng Hồ Chí Minh" },
  { code: "SS004", name: "Kỹ năng nghề nghiệp" },
  { code: "SS005", name: "Phương pháp luận sáng tạo KH-CN" },
  { code: "SS006", name: "Pháp luật đại cương" },
  { code: "SS007", name: "Triết học Mác – Lênin" },
  { code: "SS008", name: "Kinh tế chính trị Mác – Lênin" },
  { code: "SS009", name: "Chủ nghĩa xã hội khoa học" },
  { code: "SS010", name: "Lịch sử Đảng Cộng sản Việt Nam" },
  { code: "SSKL1", name: "Kỹ năng mềm" },
  { code: "STA01", name: "Xác suất thống kê" },
  { code: "STAT11", name: "Xác xuất thống kê" },
  { code: "STAT3013", name: "Phân tích thống kê" },
  { code: "STAT4033", name: "Thống kê" },
  { code: "THU086", name: "Đào tạo năng lực thông tin" },
  { code: "THU107", name: "Truyền thông xã hội trong các tổ chức" },
  { code: "TLH025", name: "Tâm lý học nhân cách" },
  { code: "TOEIC 450", name: "TOEIC 450" },
  { code: "TOEIC450", name: "TOEIC 450" },
  { code: "VCPH1", name: "Lịch sử Đảng CSVN" },
  { code: "VCPL1", name: "Đường lối cách mạng của Đảng CSVN" },
  { code: "WINP1", name: "Lập trình trên Windows" },
];

// 5 môn mặc định hiển thị khi mở dropdown chưa gõ gì
const DEFAULT_SUBJECTS = ["IT001", "IT002", "IT003", "MA004", "MA005"];

const subjectCombobox = {
  open() {
    qs("subjectDropdown").classList.add("open");
    const currentVal = (qs("postSubject")?.value || "").trim();
    if (currentVal) {
      this.renderOptions(this.search(currentVal));
    } else {
      this.renderOptions(UIT_SUBJECTS.slice(0, 100));
    }
  },
  close() {
    setTimeout(() => { qs("subjectDropdown")?.classList.remove("open"); }, 200);
  },
  normalize(str) {
    return str.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\u0111/g, "d");
  },
  search(val) {
    const q = this.normalize(val);
    const exact = [], startCode = [], startName = [], contains = [];
    for (const s of UIT_SUBJECTS) {
      const nc = this.normalize(s.code);
      const nn = this.normalize(s.name);
      if (nc === q || nn === q) exact.push(s);
      else if (nc.startsWith(q)) startCode.push(s);
      else if (nn.startsWith(q)) startName.push(s);
      else if (nc.includes(q) || nn.includes(q)) contains.push(s);
    }
    return [...exact, ...startCode, ...startName, ...contains].slice(0, 100);
  },
  onInput(val) {
    const trimmed = val.trim();
    if (!trimmed) {
      this.renderOptions(UIT_SUBJECTS.slice(0, 100));
    } else {
      this.renderOptions(this.search(trimmed));
    }
  },
  renderOptions(list) {
    const el = qs("subjectDropdown");
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div style="padding:10px;color:var(--text-muted);font-size:0.85rem">Không tìm thấy môn học</div>`;
      return;
    }
    el.innerHTML = list.map(s => {
      const safeName = s.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const safeCode = s.code.replace(/'/g, "\\'");
      return `<div class="subject-option" onclick="subjectCombobox.select('${safeName}','${safeCode}')"><span class="subject-code">${s.code}</span>${s.name}</div>`;
    }).join("");
  },
  select(name, code) {
    qs("postSubject").value = name;
    qs("postSubjectCode").value = code;
    this.close();
  }
};

document.addEventListener("click", (e) => {
  if (!e.target.closest("#subjectComboboxWrap")) {
    qs("subjectDropdown")?.classList.remove("open");
  }
});

// F1: Profile Panel
function openProfilePanel(userId, fullName, mssv, avatarUrl, bio, isVerified) {
  qs("profilePanelName").textContent = fullName || "Ẩn danh";
  qs("profilePanelMSSV").textContent = "MSSV: " + (mssv || "--------");
  qs("profilePanelBio").textContent = bio || "Chưa có thông tin.";

  const badge = qs("profilePanelBadge");
  if (isVerified) {
    badge.className = "profile-panel-badge verified";
    badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Sinh viên UIT`;
  } else {
    badge.className = "profile-panel-badge unverified";
    badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Khách`;
  }

  const initials = (fullName || "U").trim().slice(0, 1).toUpperCase();
  if (avatarUrl && avatarUrl !== "null" && avatarUrl !== "undefined") {
    qs("profilePanelAvatar").innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;">`;
  } else {
    qs("profilePanelAvatar").innerHTML = initials;
  }

  const chatBtn = qs("profilePanelChatBtn");
  if (currentUser && userId && userId !== currentUser.id) {
    chatBtn.style.display = "flex";
    chatBtn.onclick = () => {
      closeProfilePanel();
      startChatWith(userId, fullName, mssv, avatarUrl);
    };
  } else {
    chatBtn.style.display = "none";
  }

  qs("profilePanel").classList.add("open");
  qs("profilePanelBackdrop").classList.add("open");
}

function closeProfilePanel() {
  qs("profilePanel").classList.remove("open");
  qs("profilePanelBackdrop").classList.remove("open");
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

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
  const hasAnyFilter = Object.values(activeFilters).some((v, i) => {
    if (Object.keys(activeFilters)[i] === 'sort') return false;
    return !!v;
  });
  if (qs("clearFilter")) qs("clearFilter").style.display = hasAnyFilter ? "inline-flex" : "none";
  if (dropdownId) qs(dropdownId)?.classList.remove("open");
  renderCards();
}

function filterSubjectDropdown(val) {
  const query = val.toLowerCase().trim();
  // Lấy các môn có tên hoặc mã khớp với query từ mảng UIT_SUBJECTS[cite: 7]
  const filtered = UIT_SUBJECTS.filter(s =>
    s.name.toLowerCase().includes(query) ||
    s.code.toLowerCase().includes(query)
  ).slice(0, 50); // Chỉ hiện top 50 để tránh lag UI

  renderSubjectFilterList(filtered);
}

function setSort(value, dropdownId) {
  activeFilters.sort = value;
  const chip = qs("sortChip");
  if (chip) chip.classList.toggle("chip-active", value !== "newest");
  if (dropdownId) qs(dropdownId)?.classList.remove("open");
  renderCards();
}

function clearFilters() {
  activeFilters = { year: "", subject: "", method: "", tutor_role: "", sort: "newest" };
  if (qs("clearFilter")) qs("clearFilter").style.display = "none";
  if (qs("searchInput")) qs("searchInput").value = "";
  if (qs("sortChip")) qs("sortChip").classList.remove("chip-active");
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
      else { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }

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
  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local timezone

  let cards = allCards.filter((card) => {
    if (card.type !== currentMode) return false;

    // Ẩn các bài đăng có ngày học đã qua
    const dateStr = card.session_start_datetime || card.session_date;
    if (dateStr && dateStr.substring(0, 10) < todayStr) {
      return false;
    }
    return true;
  });

  if (activeFilters.subject && activeFilters.subject !== "") {
    cards = cards.filter((card) => card.subject === activeFilters.subject);
  }

  if (activeFilters.method && activeFilters.method !== "") {
    cards = cards.filter((card) => card.method === activeFilters.method);
  }

  if (activeFilters.tutor_role && activeFilters.tutor_role !== "") {
    cards = cards.filter((card) => card.type === "tutor" && card.tutor_role === activeFilters.tutor_role);
  }

  if (activeFilters.year && activeFilters.year !== "") {
    // MSSV 8 digits: 2 first = year (e.g. 2025 -> 25)
    const yr = activeFilters.year.toString();
    const prefix2 = yr.slice(-2); // last 2 digits of year
    cards = cards.filter((card) => {
      const mssv = String(card.profiles?.mssv || card.mssv || "");
      return mssv.startsWith(prefix2);
    });
  }

  if (query) {
    cards = cards.filter((card) => {
      const blob = `${card.subject} ${card.note || ""} ${card.profiles?.full_name || ""} ${card.mssv || ""}`.toLowerCase();
      return blob.includes(query);
    });
  }

  // Sort
  if (activeFilters.sort === "oldest") {
    cards = cards.slice().sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  } else {
    cards = cards.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
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

  const timeTagText = getTimeTagText(card.session_start_datetime);
  const timeBadge = `<span class="chip">${getTimeTagText(card.time)}</span>`;
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
          ${timeBadge}
          ${modeBadge}
          ${tutorBadge}
        </div>
        <div class="card-info" style="margin-top:14px">
          <div class="card-info-row">Thời gian: ${escapeHtml(card.time || "-")}</div>
          <div class="card-info-row">${card.method === "online" ? "Link" : "Địa điểm"}: ${escapeHtml(card.location_or_link || "-")}</div>
          ${card.content ? `<div class="card-info-row" style="white-space:normal;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">Nội dung: ${escapeHtml(card.content)}</div>` : ""}
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
  // F4: Guest wall
  if (!currentUser) {
    qs("cardsGrid").innerHTML = `
      <div class="guest-wall" style="grid-column:1/-1">
        <div class="guest-wall-icon">
          <svg width="64" height="64" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="11" cy="10" r="5" fill="#9CCDDB" />
          <circle cx="21" cy="10" r="5" fill="#5790AB" />
          <path d="M2 26c0-5 4-8 9-8h10c5 0 9 3 9 8" stroke="#D0D7E1" stroke-width="2.2" stroke-linecap="round" fill="none" />
          <path d="M14 20.5c0-2.5 3-4 7-4s7 1.5 7 4" stroke="#9CCDDB" stroke-width="2" stroke-linecap="round" fill="none" />
          </svg>
        </div>
        <div class="guest-wall-title">Đăng nhập để xem bài đăng</div>
        <div class="guest-wall-sub">UIT Study Buddy chỉ hiển thị bài đăng cho người dùng đã đăng nhập.</div>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn-full" style="width:auto;padding:12px 28px" onclick="openModal('loginModal')">Đăng nhập</button>
          <button class="btn-full secondary" style="width:auto;padding:12px 28px" onclick="openModal('registerModal')">Tạo tài khoản</button>
        </div>
      </div>`;
    qs("cardCount").textContent = "";
    qs("modeTitle").textContent = currentMode === "study"
      ? "Study Buddy - Học nhóm hăng say, điểm 10 trao tay"
      : "Tutor - Kết nối gia sư nội bộ";
    return;
  }
  const cards = getFilteredCards();
  const emptyHtml = `<div class="empty-state" style="padding:20px;text-align:center;grid-column:1/-1"><div class="detail-name" style="margin-bottom:8px;white-space:normal;">Không tìm thấy kết quả</div><div style="font-size:0.85rem;color:var(--text-muted)">Thử đổi bộ lọc hoặc từ khóa tìm kiếm.</div></div>`;
  qs("cardsGrid").innerHTML = cards.length ? cards.map(buildCard).join("") : emptyHtml;
  qs("modeTitle").textContent = currentMode === "study"
    ? "Study Buddy - Học nhóm hăng say, điểm 10 trao tay"
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

    let rawCards = [...(studyRes.data || []), ...(tutorRes.data || [])];
    allCards = rawCards;

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
  if (mode === "dashboard" && !currentUser) { openModal("loginModal"); return; }
  currentMode = mode;
  localStorage.setItem("sb_last_mode", mode);

  const btnStudy = qs("modeStudy");
  const btnTutor = qs("modeTutor");
  const btnDashboard = qs("modeDashboard");

  if (btnStudy && btnTutor && btnDashboard) {
    btnStudy.classList.toggle("active", mode === "study");
    btnTutor.classList.toggle("active", mode === "tutor");
    btnDashboard.classList.toggle("active", mode === "dashboard");
  }

  // ---- ĐOẠN MÃ THÊM MỚI BẮT ĐẦU TỪ ĐÂY ----
  const filterTutorRole = qs("filterTutorRole");
  if (filterTutorRole) {
    if (mode === "tutor") {
      filterTutorRole.style.display = "flex";
    } else {
      filterTutorRole.style.display = "none";
      activeFilters.tutor_role = "";
    }
  }

  if (mode === "dashboard") {
    qs("homeView").style.display = "none";
    qs("dashboardView").style.display = "flex";
    renderDashboard();
  } else {
    qs("homeView").style.display = "block";
    qs("dashboardView").style.display = "none";
    renderCards();
  }
}

let dashboardHistoryData = [];
let calendarViewDate = new Date(); // Ngày đang hiển thị trên lịch (tháng/năm)
let calendarSelectedDate = new Date(); // Ngày đang được chọn (để lọc bài)

async function renderDashboard() {
  renderCalendar();
  const greetingEl = qs("dashGreeting");
  if (greetingEl) {
    greetingEl.textContent = `Chào buổi sáng, ${currentProfile?.full_name || "Bạn"}`;
  }

  qs("dashMyPosts").innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem">Đang tải...</div>';
  qs("dashUpcoming").innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem">Đang tải...</div>';

  if (!currentUser) return;

  try {
    if (!apiAvailable) {
      qs("dashMyPosts").innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem">Backend không khả dụng.</div>';
      qs("dashUpcoming").innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem">Backend không khả dụng.</div>';
      return;
    }
    const res = await apiFetch("/api/requests/history");
    dashboardHistoryData = res.data || [];
    if (window.historyManager) window.historyManager.historyCache = dashboardHistoryData;
    const all = dashboardHistoryData;

    const myPosts = all.filter(c => c.user_id === currentUser.id);
    const myJoined = all.filter(c => c.user_id !== currentUser.id);

    if (qs("dashStatTotalPosts")) qs("dashStatTotalPosts").textContent = myPosts.length;
    if (qs("dashStatUpcoming")) qs("dashStatUpcoming").textContent = myJoined.length;
    if (qs("dashStatsUpcomingText")) qs("dashStatsUpcomingText").textContent = `Bạn có ${myJoined.length} lịch hẹn sắp tới.`;

    // ---- TÍNH TOÁN STATS THỰC TẾ ----
    // 1. Tổng phiên học (cả tạo và tham gia)
    if (qs("dashStatTotalJoined")) qs("dashStatTotalJoined").textContent = all.length;

    // 2. Môn đã học tháng này (4 tuần qua) và đếm phiên học tháng này
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    const recentSessions = all.filter(item => {
      const dateStr = item.session_start_datetime || item.session_date;
      if (!dateStr) return false;
      return new Date(dateStr.substring(0, 10)) >= fourWeeksAgo;
    });

    if (qs("dashStatJoinedMonth")) {
      qs("dashStatJoinedMonth").textContent = `Tháng này: ${recentSessions.length}`;
    }

    // Tạo Set các môn học (nếu không có subject thì gộp vào 'Khác')
    const uniqueSubjects = new Set();
    recentSessions.forEach(item => {
      if (item.subject && item.subject.trim() !== '') {
        uniqueSubjects.add(item.subject.trim().toLowerCase());
      }
    });

    if (qs("dashStatMonthSubjects")) qs("dashStatMonthSubjects").textContent = uniqueSubjects.size;

    // Render Chart if Canvas exists
    try {
      const ctx = document.getElementById('activityChart');
      if (ctx && window.Chart && !window.activityChartInstance) {
        // Mock data for weekly activity
        const data = {
          labels: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
          datasets: [{
            label: 'Thời gian học (phút)',
            data: [20, 45, 30, 80, 50, 60, 40],
            fill: false,
            borderColor: 'rgb(214, 69, 69)',
            tension: 0.4,
            pointBackgroundColor: 'rgb(214, 69, 69)',
            borderWidth: 2
          }]
        };
        const config = {
          type: 'line',
          data: data,
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { display: false, min: 0 },
              x: {
                grid: { display: false, drawBorder: false },
                ticks: { font: { family: "'Manrope', sans-serif", weight: 'bold' }, color: '#5f7487' }
              }
            }
          }
        };
        window.activityChartInstance = new Chart(ctx, config);
      }
    } catch (chartErr) {
      console.warn("Chart failed to render", chartErr);
    }

    window.currentDashFilter = window.currentDashFilter || "all";

    window.setDashFilter = function (value, text) {
      window.currentDashFilter = value;
      const btn = qs("dashFilterBtn");
      if (btn) btn.innerHTML = `${text} <span>▾</span>`;
      const drop = qs("dropDashFilter");
      if (drop) drop.classList.remove("open");
      window.renderDashboardList();
    };

    // Hàm render danh sách theo bộ lọc
    window.renderDashboardList = function () {
      const filterValue = window.currentDashFilter;
      let listToRender = [];

      if (filterValue === "all") {
        listToRender = all;
      } else if (filterValue === "created") {
        listToRender = myPosts;
      } else if (filterValue === "joined") {
        listToRender = myJoined;
      }

      // Lọc bỏ những lớp đã qua (so với ngày hôm nay)
      const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local timezone
      listToRender = listToRender.filter(item => {
        const dateStr = item.session_start_datetime || item.session_date;
        if (!dateStr) return true; // Giữ lại nếu không có ngày
        return dateStr.substring(0, 10) >= todayStr;
      });

      if (!listToRender.length) {
        qs("dashMyPosts").innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem">Không có lớp học nào trong danh sách.</div>';
      } else {
        qs("dashMyPosts").innerHTML = listToRender.map(c => `
          <div class="mdash-post-item" onclick="openDetail(${c.id})">
            <div style="display: flex; align-items: center; gap: 16px;">
              <div class="mdash-avatar ${c.type === 'tutor' ? 'tutor' : 'study'}">
                <i class="fa-solid fa-${c.type === 'tutor' ? 'chalkboard-user' : 'user-graduate'}"></i>
              </div>
              <div>
                <h4 style="font-weight: 700; color: var(--text); margin-bottom: 2px;">${escapeHtml(c.subject || "Bài đăng")}</h4>
                <div style="font-size: 0.875rem; font-weight: 500; color: var(--text-muted);">${escapeHtml(c.profiles?.full_name || "Ẩn danh")} • ${c.type === 'tutor' ? 'Gia sư' : 'Học viên'} ${c.user_id === currentUser.id ? '(Bạn tạo)' : ''}</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 16px;">
              <span class="mdash-pill-time">${escapeHtml(c.session_date ? c.session_date.substring(0, 10) : (c.time || "-"))}</span>
              <button class="mdash-btn-join" onclick="event.stopPropagation(); openDetail(${c.id})">Chi tiết</button>
            </div>
          </div>
        `).join("");
      }
    };

    // Render danh sách mặc định lần đầu
    if (window.renderDashboardList) {
      window.renderDashboardList();
    }

    // Initialize sidebar with the currently selected date (defaults to today)
    renderUpcomingByDate(calendarSelectedDate.getDate(), calendarSelectedDate.getMonth() + 1, calendarSelectedDate.getFullYear());

  } catch (err) {
    qs("dashMyPosts").innerHTML = `<div style="color:var(--danger);font-size:0.9rem">Lỗi: ${err.message}</div>`;
  }
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
  // F2: Cho phép bất kỳ email hợp lệ (không chỉ UIT)
  if (!email.includes("@") || email.length < 5) {
    showAlert(errorEl, "Email không hợp lệ");
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
    showAlert(errorEl, "Nhập email trước khi đặt lại mật khẩu");
    return;
  }
  if (!validateEmail(email)) {
    showAlert(errorEl, "Email không hợp lệ");
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
  if (!validateEmail(email)) {
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

  window.editPostId = null;
  if (qs("postBtn")) qs("postBtn").textContent = "Đăng bài";
  historyManager.resetPostModal();
  qs("postModalTitle").textContent =
    currentMode === "study" ? "Tạo yêu cầu Study Buddy" : "Tạo yêu cầu Tutor";
  qs("postName").value = currentProfile?.full_name || "";
  qs("postMSSV").value = currentProfile?.mssv || "";
  qs("postSubject").value = "";
  if (qs("postSubjectCode")) qs("postSubjectCode").value = "";
  if (qs("postDate")) qs("postDate").value = "";
  if (qs("postStartTime")) qs("postStartTime").value = "";
  if (qs("postEndTime")) qs("postEndTime").value = "";
  if (qs("postContent")) qs("postContent").value = "";
  if (qs("postDriveLink")) qs("postDriveLink").value = "";
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
  const subject_code = qs("postSubjectCode")?.value || null;
  const method = qs("postMethod").value;

  let session_date = qs("postDate")?.value;

  // Tu dong chuyen doi tu DD/MM hoac DD/MM/YYYY sang YYYY-MM-DD cho he thong hieu
  if (session_date && session_date.includes("/")) {
    const parts = session_date.split("/");
    if (parts.length >= 2) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      // Neu nguoi dung chi go dd/mm, he thong se tu dong lay nam hien tai
      const year = parts[2] || new Date().getFullYear();
      session_date = `${year}-${month}-${day}`;
    }
  }
  const session_start = qs("postStartTime")?.value;
  const session_end = qs("postEndTime")?.value;
  const content = qs("postContent")?.value.trim();
  const drive_link = qs("postDriveLink")?.value.trim();

  const slots = Number(qs("postSlots").value || 4);
  const note = qs("postNote").value.trim();
  const locationOrLink =
    method === "online" ? qs("postLink").value.trim() : qs("postLocation").value.trim();
  const tutorRole = currentMode === "tutor" ? qs("postTutorRole").value : null;

  let time = "";
  let session_start_datetime = null;
  if (session_date && session_start) {
    const parts = session_date.split("-");
    if (parts.length === 3) {
      time = `${parts[2]}/${parts[1]}/${parts[0]} ${session_start}` + (session_end ? ` - ${session_end}` : "");
      session_start_datetime = `${session_date}T${session_start}:00`;
    }
  }

  // Đã thêm || !content vào đây và cập nhật lại câu thông báo
  if (!subject || (!time && !session_date) || !locationOrLink || !content) {
    showToast("Vui lòng nhập đủ thông tin (Môn học, Ngày, Địa điểm/Link, Nội dung buổi học)", "error");
    return;
  }

  try {
    setButtonLoading("postBtn", true, "Đang đăng bài...");
    if (!apiAvailable || !getToken()) {
      throw new Error("Backend chưa chạy nên không thể tạo bài");
    }

    const payload = {
      type: currentMode,
      subject,
      subject_code,
      method,
      location_or_link: locationOrLink,
      time,
      slots,
      session_start_datetime
    };

    if (session_date) payload.session_date = session_date;
    if (session_start) payload.session_start = session_start;
    if (session_end) payload.session_end = session_end;
    if (note) payload.note = note;
    if (content) payload.content = content;
    if (drive_link) payload.drive_link = drive_link;
    if (tutorRole) payload.tutor_role = tutorRole;

    if (window.editPostId) {
      await apiFetch(`/api/requests/${window.editPostId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      window.editPostId = null;
      if (qs("postBtn")) qs("postBtn").textContent = "Đăng bài";
    } else {
      await apiFetch("/api/requests", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    await loadCards();
    if (currentMode === "dashboard") {
      await renderDashboard();
    }
    closeModal("postModal");
    showToast("Đăng bài thành công", "success");
  } catch (error) {
    showToast(error.message || "Không thể tạo bài đăng", "error");
  } finally {
    setButtonLoading("postBtn", false);
  }
}

function findCard(id) {
  let card = allCards.find((card) => Number(card.id) === Number(id));
  if (!card && typeof dashboardHistoryData !== "undefined") {
    card = dashboardHistoryData.find((card) => Number(card.id) === Number(id));
  }
  return card;
}

function openDetail(id) {
  const card = findCard(id);
  if (!card) return;

  const profile = card.profiles || {};
  const timeLabel = getTimeTagText(card.time);

  qs("detailBody").innerHTML = `
    <div class="detail-header-wrap">
      <div class="detail-avatar-row">
        <div class="detail-avatar">${escapeHtml((profile.full_name || "U").slice(0, 1).toUpperCase())}</div>
        <div>
          <div class="detail-name">${escapeHtml(profile.full_name || "Ẩn danh")}</div>
          <div class="detail-mssv">MSSV: ${escapeHtml(profile.mssv || "--------")} - ${timeLabel}</div>
        </div>
      </div>
    </div>
    <div class="detail-info-grid">
      <div class="detail-info-item"><div class="detail-info-label">Môn học</div><div class="detail-info-value">${escapeHtml(card.subject || "-")}</div></div>
      <div class="detail-info-item"><div class="detail-info-label">Thời gian</div><div class="detail-info-value">${escapeHtml(card.time || "-")}</div></div>
      <div class="detail-info-item"><div class="detail-info-label">Hình thức</div><div class="detail-info-value">${card.method === "online" ? "Online" : "Offline"}</div></div>
      <div class="detail-info-item"><div class="detail-info-label">${card.method === "online" ? "Link họp" : "Địa điểm"}</div><div class="detail-info-value">${escapeHtml(card.location_or_link || "-")}</div></div>
      <div class="detail-info-item"><div class="detail-info-label">Số lượng</div><div class="detail-info-value">${card.current_slots || 0}/${card.slots || 0}</div></div>
      ${card.content ? `<div class="detail-info-item" style="grid-column:1/-1"><div class="detail-info-label">Nội dung buổi học</div><div class="detail-info-value" style="white-space:pre-wrap;line-height:1.6">${escapeHtml(card.content)}</div></div>` : ""}
      ${card.drive_link ? `<div class="detail-info-item" style="grid-column:1/-1"><div class="detail-info-label">📎 Tài liệu</div><div class="detail-info-value"><a href="${escapeHtml(card.drive_link)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);text-decoration:none;word-break:break-all"><i class="fa-solid fa-link" style="margin-right:6px"></i>Mở tài liệu</a></div></div>` : ""}
    </div>
    ${card.note ? `<div class="detail-note">${escapeHtml(card.note)}</div>` : ""}
  `;

  const profileAvatarUrl = profile.avatar_url || "";

  if (currentMode === "dashboard") {
    const isCreator = currentUser && card.user_id === currentUser.id;
    const editBtn = isCreator
      ? `<button class="btn-full" onclick="editPost(${card.id})">Chỉnh sửa</button>`
      : `<button class="btn-full" onclick="showToast('Bạn không thể chỉnh sửa bài của người khác', 'error')">Chỉnh sửa</button>`;

    qs("detailFooter").innerHTML = `<button class="btn-full secondary" onclick="closeModal('detailModal')">Đóng</button>${editBtn}`;
  } else {
    qs("detailFooter").innerHTML = !currentUser
      ? `<button class="btn-full secondary" onclick="closeModal('detailModal')">Đóng</button><button class="btn-full" onclick="closeModal('detailModal');openModal('loginModal')">Đăng nhập để tham gia</button>`
      : `<button class="btn-full secondary" onclick="closeModal('detailModal')">Đóng</button><button class="btn-full secondary" onclick="startChatWith('${encodeInline(card.user_id || "")}', '${encodeInline(profile.full_name || "Người dùng")}', '${encodeInline(profile.mssv || "")}', '${encodeInline(profileAvatarUrl)}')">Chat</button><button class="btn-full" id="detailJoinBtn" onclick="joinRequest(${card.id})">Tham gia</button>`;
  }

  openModal("detailModal");
}

window.editPostId = null;

window.editPost = function (id) {
  const card = findCard(id);
  if (!card) return;
  closeModal('detailModal');

  window.editPostId = id;
  historyManager.resetPostModal();
  qs("postModalTitle").textContent = "Chỉnh sửa bài đăng";
  qs("postName").value = card.profiles?.full_name || currentProfile?.full_name || "";
  qs("postMSSV").value = card.profiles?.mssv || currentProfile?.mssv || "";
  qs("postSubject").value = card.subject || "";
  if (qs("postSubjectCode")) qs("postSubjectCode").value = card.subject_code || "";

  if (card.session_date) {
    const parts = card.session_date.split('-');
    if (parts.length === 3) {
      qs("postDate").value = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  } else {
    if (qs("postDate")) qs("postDate").value = "";
  }

  if (qs("postStartTime")) qs("postStartTime").value = card.session_start || "";
  if (qs("postEndTime")) qs("postEndTime").value = card.session_end || "";
  if (qs("postContent")) qs("postContent").value = card.content || "";
  if (qs("postDriveLink")) qs("postDriveLink").value = card.drive_link || "";
  qs("postLink").value = card.method === "online" ? (card.location_or_link || "") : "";
  qs("postLocation").value = card.method === "offline" ? (card.location_or_link || "") : "";
  qs("postNote").value = card.note || "";
  qs("postSlots").value = card.slots || "4";
  qs("postMethod").value = card.method || "online";
  qs("postTutorRole").value = card.tutor_role || "seeking";
  qs("unverifiedPostWarn").style.display = "none";
  qs("tutorRoleField").style.display = card.type === "tutor" ? "block" : "none";
  toggleLocationField();

  if (qs("postBtn")) qs("postBtn").textContent = "Lưu chỉnh sửa";
  openModal("postModal");
};

async function joinRequest(id) {
  try {
    setButtonLoading("detailJoinBtn", true, "Đang tham gia...");
    if (!apiAvailable || !getToken()) {
      throw new Error("Backend chưa chạy nên không thể tham gia");
    }

    await apiFetch(`/api/requests/${id}/join`, { method: "POST" });
    await loadCards();
    if (currentMode === "dashboard") {
      await renderDashboard();
    }
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
    : `<div class="empty-state" style="padding:20px; text-align:center;"><div class="detail-name" style="margin-bottom:8px; white-space:normal;">Chưa có tin nhắn</div><div style="font-size:0.85rem; color:var(--text-muted); white-space:normal; word-break:break-word; line-height:1.5;">Các cuộc trò chuyện sẽ hiện ở đây khi bạn bắt đầu chat.</div></div>`;
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

    if (currentChatUser) {
      currentChatUser = chatCache.find(c => c.id === currentChatUser.id) || currentChatUser;
    }

    renderChatList();
    updateNavBadge();
  } catch (error) {
    showToast(error.message || "Không tải được danh sách hội thoại", "error");
  }
}

function upsertChat(chat) {
  const id = String(chat.id || "");
  let index = chatCache.findIndex((item) => item.id === id);

  const normalized = {
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
  };

  if (index >= 0) {
    const existing = chatCache[index];
    chatCache[index] = {
      ...existing,
      name: chat.name || existing.name,
      mssv: chat.mssv || existing.mssv,
      avatarUrl: chat.avatarUrl || existing.avatarUrl,
      last: chat.last !== undefined && chat.last !== "" ? chat.last : existing.last,
      lastTime: chat.lastTime !== undefined && chat.lastTime !== "" ? chat.lastTime : existing.lastTime,
      unreadCount: chat.unreadCount !== undefined ? chat.unreadCount : existing.unreadCount,
      messages: chat.messages && chat.messages.length ? chat.messages : existing.messages,
      loaded: chat.loaded !== undefined ? chat.loaded : existing.loaded,
      draft: chat.draft !== undefined ? chat.draft : existing.draft,
    };
  } else {
    chatCache.unshift(normalized);
  }

  chatCache.sort((a, b) => {
    const timeA = a.lastTime ? new Date(a.lastTime).getTime() : 0;
    const timeB = b.lastTime ? new Date(b.lastTime).getTime() : 0;
    return timeB - timeA;
  });

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
    ? `<img src="${escapeHtml(chat.avatarUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='${escapeHtml(name.trim().slice(0, 1).toUpperCase())}'"/>`
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
      <input id="chatInput" placeholder="Nhập tin nhắn..." value="${escapeHtml(chat.draft || '')}" oninput="if(currentChatUser) { currentChatUser.draft = this.value; localStorage.setItem('chatDraft_' + currentChatUser.id, this.value); }" />
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
    html = `<div class="empty-state" style="padding:20px; text-align:center;"><div class="detail-name" style="margin-bottom:8px; white-space:normal;">Chưa có tin nhắn</div><div style="font-size:0.85rem; color:var(--text-muted); white-space:normal; word-break:break-word; line-height:1.5;">Hãy bắt đầu cuộc trò chuyện đầu tiên.</div></div>`;
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

      ${profile.is_verified
      ? `<div class="verified-banner" style="border-radius:16px;display:flex;align-items:center;gap:12px;padding:16px 20px;margin-bottom:24px;"><i class="fa-solid fa-circle-check" style="font-size:1.3rem;"></i><span style="font-weight:700;font-size:0.95rem;">Tài khoản sinh viên đã xác thực</span></div>`
      : `<div class="verify-banner" style="border-radius:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;margin-bottom:24px;"><div><div class="verify-banner-title" style="font-weight:800;color:var(--warn);margin-bottom:4px;display:flex;align-items:center;gap:6px;"><i class="fa-solid fa-triangle-exclamation"></i> Chưa xác thực</div><div class="verify-banner-text" style="font-size:0.85rem;">Xác nhận email trường để mở khóa tính năng.</div></div><button class="btn-primary" style="flex-shrink:0;padding:10px 18px;font-size:0.85rem;border-radius:99px;" onclick="verificationManager.openModal()">Xác thực</button></div>`
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

function renderCalendar() {
  const monthEl = qs("calendarMonth");
  const gridEl = qs("calendarGrid");
  if (!monthEl || !gridEl) return;

  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  // 1. In ra tên tháng
  const monthNames = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
  monthEl.textContent = `${monthNames[month]} - ${year}`;

  // 2. Tạo phần tiêu đề các ngày trong tuần
  let html = `
        <div class="mdash-calendar-day-name">T2</div>
        <div class="mdash-calendar-day-name">T3</div>
        <div class="mdash-calendar-day-name">T4</div>
        <div class="mdash-calendar-day-name">T5</div>
        <div class="mdash-calendar-day-name">T6</div>
        <div class="mdash-calendar-day-name">T7</div>
        <div class="mdash-calendar-day-name">CN</div>
    `;

  // 3. Tính toán khoảng trống đầu tháng
  const firstDay = new Date(year, month, 1).getDay();
  const emptySlots = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Điền ô trống
  for (let i = 0; i < emptySlots; i++) {
    html += `<div></div>`;
  }

  // Điền các ngày trong tháng
  for (let d = 1; d <= daysInMonth; d++) {
    const isActive = (isCurrentMonth && d === today.getDate()) ? "active" : "";
    // Nếu ngày này trùng với calendarSelectedDate thì cũng bôi đỏ
    const isSelected = (calendarSelectedDate.getFullYear() === year && calendarSelectedDate.getMonth() === month && calendarSelectedDate.getDate() === d) ? "active" : "";

    html += `<div class="mdash-calendar-day ${isSelected || isActive}" onclick="selectCalendarDate(${d}, ${month + 1}, ${year}, this)">${d}</div>`;
  }

  gridEl.innerHTML = html;

  // Cập nhật tiêu đề ngày đang chọn (ví dụ: "15 Tháng 5, 2024")
  const selectedDateEl = qs("calendarSelectedDate");
  if (selectedDateEl) {
    selectedDateEl.textContent = `${calendarSelectedDate.getDate()} ${monthNames[calendarSelectedDate.getMonth()]}, ${calendarSelectedDate.getFullYear()}`;
  }
}

function changeCalendarMonth(delta) {
  calendarViewDate.setMonth(calendarViewDate.getMonth() + delta);
  renderCalendar();
}

function changeCalendarYear() {
  const currentYear = calendarViewDate.getFullYear();
  const newYear = prompt("Nhập năm bạn muốn xem:", currentYear);
  if (newYear && !isNaN(newYear)) {
    calendarViewDate.setFullYear(parseInt(newYear));
    renderCalendar();
  }
}

// Hàm xử lý sự kiện khi bấm vào một ngày bất kỳ
function selectCalendarDate(day, month, year, element) {
  calendarSelectedDate = new Date(year, month - 1, day);

  // Vẽ lại lịch để cập nhật trạng thái active
  renderCalendar();

  // Filter sessions
  renderUpcomingByDate(day, month, year);
}

function renderUpcomingByDate(day, month, year) {
  const container = qs("dashUpcoming");
  if (!container) return;

  const targetDateStr = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  const targetIsoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Filter from dashboardHistoryData
  const filtered = (dashboardHistoryData || []).filter(item => {
    // 1. Kiểm tra session_start_datetime (Tin cậy nhất)
    // So sánh phần YYYY-MM-DD từ chuỗi ISO để tránh lỗi múi giờ UTC vs local
    if (item.session_start_datetime) {
      const isoDatePart = item.session_start_datetime.substring(0, 10); // "YYYY-MM-DD"
      return isoDatePart === targetIsoDate;
    }
    // 2. Kiểm tra session_date
    if (item.session_date) {
      return item.session_date.substring(0, 10) === targetIsoDate;
    }

    // 3. Dự phòng bằng cách tách chuỗi time (DD/MM/YYYY)
    if (item.time) {
      const datePart = item.time.split(" ").shift().trim();
      const parts = datePart.split("/");
      if (parts.length === 3) {
        return parseInt(parts[0]) === day && parseInt(parts[1]) === month && parseInt(parts[2]) === year;
      }
    }
    return false;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem;text-align:center;padding:20px;">Trống</div>';
    return;
  }

  container.innerHTML = filtered.map(c => `
    <div class="mdash-upcoming-item" onclick="openDetail(${c.id})">
      <div class="mdash-upcoming-icon">
        <i class="fa-solid fa-users"></i>
      </div>
      <h4 style="font-weight: 700; color: var(--text); margin-bottom: 4px;">${escapeHtml(c.subject || "Bài đăng")}</h4>
      <p style="font-size: 0.875rem; font-weight: 500; color: var(--text-muted); margin-bottom: 12px;">${escapeHtml(c.location_or_link || "Phòng học")}</p>
      <div style="display: inline-block; padding: 4px 12px; background: var(--bg-card); border-radius: 9999px; font-size: 0.75rem; font-weight: 700; color: var(--text); box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); border: 1px solid var(--border);">
        ${escapeHtml(c.time || "-")}
      </div>
    </div>
  `).join("");
}

function getTimeTagText(timeString) {
  // 1. Dùng .shift() lấy phần tử đầu tiên (VD: "24/05/2026") rồi mới xóa khoảng trắng
  const datePart = String(timeString).split(",").shift().trim();

  // 2. Tách thành các con số bằng dấu /
  const parts = datePart.split("/");

  // 3. Trích xuất Ngày, Tháng, Năm (dùng shift() liên tục để tránh mất dấu ngoặc vuông)
  const day = parseInt(parts.shift(), 10);
  const month = parseInt(parts.shift(), 10) - 1; // Javascript đếm tháng từ 0
  const year = parseInt(parts.shift(), 10);

  // 4. Khởi tạo ngày
  const target = new Date(year, month, day);
  target.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 5. Tính toán (86400000 = 1000 * 60 * 60 * 24)
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) return "Đã diễn ra";
  if (diffDays === 0) return "Hôm nay";
  if (diffDays === 1) return "Ngày mai";
  return `Còn ${diffDays} ngày`;
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
      previewEl.innerHTML = `<img src="${currentProfile.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
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

function updateSubjectFilter() {
  // Mặc định hiển thị 20 môn đầu tiên khi mở filter
  renderSubjectFilterList(UIT_SUBJECTS.slice(0, 20));
}

function renderSubjectFilterList(list) {
  const container = document.getElementById('subjectFilterList');
  if (!container) return;

  let html = `<div class="chip-option" onclick="setFilter('subject','','dropSubject')">Tất cả môn học</div>`;
  html += list.map(sub => `
        <div class="chip-option" onclick="setFilter('subject','${sub.name}','dropSubject')">
            <small style="opacity:0.6">${sub.code}</small> - ${sub.name}
        </div>
    `).join("");

  container.innerHTML = html;
}

function formatDateInput(input) {
  // Xóa tất cả các ký tự không phải là số
  let v = input.value.replace(/\D/g, '');

  // Tự động chèn dấu '/' theo định dạng dd/mm/yyyy
  if (v.length >= 5) {
    v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4, 8);
  } else if (v.length >= 3) {
    v = v.slice(0, 2) + '/' + v.slice(2, 4);
  }
  input.value = v;
}

async function init() {
  restoreSession();
  checkRecoveryFlow();
  updateSubjectFilter();
  if (DEMO_PREVIEW_MODE && !currentUser) {
    applyDemoPreview();
  }

  updateNavbar();
  const savedMode = localStorage.getItem("sb_last_mode");
  if (savedMode) {
    currentMode = savedMode;
  }
  switchMode(currentMode);
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

  openHistory: async function () {
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

  renderHistory: function (data) {
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
        hour: '2-digit', minute: '2-digit'
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

      let contentHtml = '';
      if (item.content) {
        contentHtml = `<div style="font-size:0.9rem; color:var(--text); background: var(--bg); padding: 8px; border-radius: 6px; margin-top: 10px;"><i class="fa-solid fa-book-open" style="color:var(--primary); margin-right:5px;"></i> <strong>Nội dung:</strong> ${escapeHtml(item.content)}</div>`;
      }

      let driveLinkHtml = '';
      if (item.drive_link) {
        driveLinkHtml = `<div style="font-size:0.9rem; margin-top: 8px; display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-folder-open" style="color:var(--text-muted); width: 14px;"></i> <a href="${escapeHtml(item.drive_link)}" target="_blank" style="color:var(--primary); text-decoration:none; word-break: break-all;">Mở tài liệu Drive</a></div>`;
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

          let removeBtnHtml = '';
          if (isCreator && !isP_Creator) {
            removeBtnHtml = `<button onclick="historyManager.removeMember(${item.id}, '${p.id}')" style="background:transparent; border:none; color:var(--danger); cursor:pointer; padding:0 0 0 4px; font-size:0.85rem;" title="Xóa khỏi nhóm"><i class="fa-solid fa-xmark"></i></button>`;
          }

          membersHtml += `
                  <div class="history-member-item" title="${escapeHtml(p.full_name)} (${isP_Creator ? 'Người tạo' : 'Thành viên'})" style="display:flex; align-items:center; gap: 6px; background: var(--bg); padding: 4px 8px; border-radius: 99px; font-size: 0.8rem;">
                      <img src="${avatarUrl}" alt="${escapeHtml(p.full_name)}" style="width:20px; height:20px; border-radius:50%;">
                      <span style="color: var(--text);">${escapeHtml(p.full_name.split(' ').pop())} ${isP_Creator ? '👑' : ''}</span>
                      ${removeBtnHtml}
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
                ${!isCreator ? `<button class="btn btn-sm" style="border:1px solid var(--border); background:var(--surface); cursor:pointer;" onclick="closeModal('historyModal'); startChatWith('${encodeInline(item.user_id)}', '${encodeInline(item.profiles.full_name)}', '${encodeInline(item.profiles.mssv || '')}', '${encodeInline(item.profiles.avatar_url || '')}');"><i class="fa-solid fa-comment"></i> Chat</button>` : ''}
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

  openEditRequestModal: function (id) {
    const request = this.historyCache.find(item => item.id === id);
    if (!request) {
      showToast("Không tìm thấy yêu cầu để sửa", "error");
      return;
    }

    this.editingRequestId = id;

    // 1. Đổ dữ liệu cơ bản và các trường MỚI (Nội dung, Link tài liệu)
    qs("postModalTitle").textContent = "Chỉnh sửa bài đăng";
    qs("postSubject").value = request.subject || "";
    if (qs("postSubjectCode")) qs("postSubjectCode").value = request.subject_code || "";
    qs("postMethod").value = request.method || "online";
    qs("postSlots").value = request.slots || 4;
    qs("postNote").value = request.note || "";

    // Thêm đồng bộ 2 trường Nội dung buổi học & Link tài liệu
    if (qs("postContent")) qs("postContent").value = request.content || "";
    if (qs("postDriveLink")) qs("postDriveLink").value = request.drive_link || "";

    // Xử lý ẩn/hiện trường Link hoặc Địa điểm
    toggleLocationField();
    if (request.method === "online") {
      qs("postLink").value = request.location_or_link || "";
    } else {
      qs("postLocation").value = request.location_or_link || "";
    }

    // Xử lý trường Vai trò (tutor_role) nếu có
    if (qs("tutorRoleField")) {
      qs("tutorRoleField").style.display = request.type === "tutor" ? "block" : "none";
      if (request.type === "tutor" && qs("postTutorRole") && request.tutor_role) {
        qs("postTutorRole").value = request.tutor_role;
      }
    }

    // Xử lý tag cảnh báo chưa xác thực
    if (qs("unverifiedPostWarn")) {
      qs("unverifiedPostWarn").style.display = currentProfile?.is_verified ? "none" : "flex";
    }

    // 2. Xử lý hiển thị Ngày và Giờ bắt đầu
    if (request.session_start_datetime) {
      const d = new Date(request.session_start_datetime);
      if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        if (qs("postDate")) qs("postDate").value = `${day}/${month}/${year}`;

        const sh = String(d.getHours()).padStart(2, '0');
        const sm = String(d.getMinutes()).padStart(2, '0');
        if (qs("postStartTime")) qs("postStartTime").value = `${sh}:${sm}`;
      }
    } else if (request.time) {
      // Cứu cánh nếu không có biến datetime từ API
      const datePart = String(request.time).split(",").shift().trim();
      if (qs("postDate")) qs("postDate").value = datePart;

      const timeMatch = String(request.time).match(/(\d{2}:\d{2})/);
      if (timeMatch && qs("postStartTime")) qs("postStartTime").value = timeMatch[0];
    }

    // 3. Xử lý hiển thị Giờ kết thúc (Bóc tách từ chuỗi time nếu có)
    if (qs("postEndTime")) {
      qs("postEndTime").value = request.session_end || ""; // Nếu backend có trường riêng
      if (!qs("postEndTime").value && request.time && request.time.includes("-")) {
        const parts = request.time.split("-");
        if (parts.length > 1) {
          qs("postEndTime").value = parts[1].trim(); // Tách lấy giờ đằng sau dấu "-"
        }
      }
    }

    // 4. Đổi nút "Đăng bài" thành "Cập nhật"
    const postBtn = qs("postBtn");
    postBtn.innerHTML = 'Cập nhật';
    postBtn.onclick = () => this.doEditRequest();

    openModal("postModal");
  },

  doEditRequest: async function () {
    if (!this.editingRequestId) return;

    const subject = qs("postSubject").value.trim();
    const subject_code = qs("postSubjectCode")?.value || null;
    const method = qs("postMethod").value;
    const note = qs("postNote").value.trim();
    const slots = Number(qs("postSlots").value || 4);
    const location_or_link = method === "online" ? qs("postLink").value.trim() : qs("postLocation").value.trim();

    // Lấy dữ liệu các trường mới
    const content = qs("postContent")?.value.trim();
    const drive_link = qs("postDriveLink")?.value.trim();
    const session_start = qs("postStartTime")?.value;
    const session_end = qs("postEndTime")?.value;

    // Dịch ngược ngày DD/MM/YYYY sang YYYY-MM-DD
    let session_date = qs("postDate")?.value;
    if (session_date && session_date.includes("/")) {
      const parts = session_date.split("/");
      if (parts.length >= 2) {
        const day = parts.shift().padStart(2, '0');
        const month = parts.shift().padStart(2, '0');
        const year = parts.length > 0 ? parts.shift() : new Date().getFullYear();
        session_date = `${year}-${month}-${day}`;
      }
    }

    if (!subject || !session_date || !session_start || !location_or_link || !content) {
      showToast("Vui long nhap du thong tin (Mon hoc, Ngay, Gio bat dau, Dia diem/Link, Noi dung buoi hoc)", "error");
      return;
    }

    let time = "";
    if (session_date && session_start) {
      const parts = session_date.split("-");
      if (parts.length === 3) {
        time = `${parts[2]}/${parts[1]}/${parts[0]} ${session_start}` + (session_end ? ` - ${session_end}` : "");
      }
    }

    const payload = {
      subject,
      subject_code,
      method,
      slots,
      location_or_link,
      session_start_datetime: `${session_date}T${session_start}:00`
    };

    if (time) payload.time = time;
    if (note) payload.note = note;
    if (content) payload.content = content;
    if (drive_link) payload.drive_link = drive_link;
    if (session_end) payload.session_end = session_end;

    const tutorRoleField = qs("tutorRoleField");
    if (tutorRoleField && tutorRoleField.style.display !== "none" && qs("postTutorRole")) {
      payload.tutor_role = qs("postTutorRole").value;
    }

    try {
      setButtonLoading("postBtn", true, "Đang cập nhật...");
      // Đổi phương thức gửi từ PUT sang PATCH
      await apiFetch(`/api/requests/${this.editingRequestId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });

      showToast("Cập nhật thành công", "success");
      closeModal("postModal");
      await loadCards();
      await this.openHistory();

      // Dời hàm reset vào đây: Chỉ khi không có lỗi mới reset form
      this.resetPostModal();
    } catch (error) {
      showToast(error.message || "Không thể cập nhật bài đăng", "error");
    } finally {
      setButtonLoading("postBtn", false);
      // Đã xóa this.resetPostModal() ở đây để ngăn chặn việc tự ý đổi nút
    }
  },

  deleteRequest: async function (id) {
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

  removeMember: async function (requestId, memberId) {
    if (!confirm("Bạn có chắc chắn muốn xóa thành viên này khỏi nhóm?")) return;
    try {
      await apiFetch(`/api/requests/${requestId}/members/${memberId}`, { method: "DELETE" });
      await this.openHistory();
      await loadCards();
      showToast("Đã xóa thành viên thành công", "success");
    } catch (error) {
      showToast(error.message || "Không thể xóa thành viên", "error");
    }
  },

  leaveRequest: async function (id) {
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

  resetPostModal: function () {
    this.editingRequestId = null;
    qs("postModalTitle").textContent = currentMode === "study" ? "Tạo yêu cầu Study Buddy" : "Tạo yêu cầu Tutor";
    const postBtn = qs("postBtn");
    postBtn.innerHTML = 'Đăng bài';
    postBtn.onclick = () => doPost();
  }
};

window.historyManager = historyManager;

// Gọi hàm khởi động
initTheme();
init();