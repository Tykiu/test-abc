import os
from typing import Any, Optional

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import AppConfig, SupabaseContext
from schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    MessageRequest,
    OtpConfirmRequest,
    RegisterRequest,
    StudyRequestPost,
    UpdatePasswordRequest,
    UpdateStudyRequest,
    UpdateProfileRequest,
    VerifyResetOtpRequest,
)
from services.auth_service import AuthService
from services.message_service import MessageService
from services.profile_service import ProfileService
from services.study_request_service import StudyRequestService
from services.utility_service import UtilityService
from services.verification_service import VerificationService


class StudyBuddyApplication:
    def __init__(self):
        self.config = AppConfig()
        self.supabase = SupabaseContext(self.config)
        self.auth_service = AuthService(self.supabase)
        self.verification_service = VerificationService(self.supabase)
        self.study_request_service = StudyRequestService(self.supabase)
        self.profile_service = ProfileService(self.supabase)
        self.message_service = MessageService(self.supabase)
        self.utility_service = UtilityService(self.supabase)
        self.app = self._create_app()
        self._register_routes()

    def _create_app(self) -> FastAPI:
        app = FastAPI(
            title="UIT Study Buddy API",
            description="Backend API cho he thong ket noi hoc tap UIT",
            version="2.0.0",
        )

        allowed_origins = [
            origin.strip()
            for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
            if origin.strip()
        ]
        if not allowed_origins:
            allowed_origins = [
                "http://localhost:5500",
                "http://127.0.0.1:5500",
                "http://localhost:3000",
            ]

        app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        return app

    def _register_routes(self):
        app = self.app
        current_user_dep = Depends(self.auth_service.get_current_user)

        @app.post("/api/auth/register", summary="Dang ky tai khoan moi")
        async def register(body: RegisterRequest):
            return await self.auth_service.register(body)

        @app.post("/api/auth/login", summary="Dang nhap")
        async def login(body: LoginRequest):
            return await self.auth_service.login(body)

        @app.post("/api/auth/forgot-password", summary="Gui email dat lai mat khau")
        async def forgot_password(body: ForgotPasswordRequest):
            return await self.auth_service.forgot_password(body)

        @app.post("/api/auth/verify-reset-otp", summary="Xac thuc ma OTP dat lai mat khau")
        async def verify_reset_otp(body: VerifyResetOtpRequest):
            return await self.auth_service.verify_reset_otp(body)

        @app.post("/api/auth/update-password", summary="Cap nhat mat khau moi")
        async def update_password(
            body: UpdatePasswordRequest, current_user: Any = current_user_dep
        ):
            return await self.auth_service.update_password(body, current_user)

        @app.post("/api/verify/send-otp", summary="Gui OTP ve email truong")
        async def send_otp(current_user: Any = current_user_dep):
            return await self.verification_service.send_otp(current_user)

        @app.post("/api/verify/confirm-otp", summary="Xac nhan OTP va danh dau verified")
        async def confirm_otp(body: OtpConfirmRequest, current_user: Any = current_user_dep):
            return await self.verification_service.confirm_otp(body, current_user)

        @app.get("/api/requests/history", summary="Lay lich su buoi hoc")
        async def get_history(current_user: Any = current_user_dep):
            return await self.study_request_service.get_history(current_user)

        @app.get("/api/requests", summary="Lay danh sach yeu cau")
        async def get_requests(
            type: Optional[str] = None,
            subject: Optional[str] = None,
            method: Optional[str] = None,
            verified_only: bool = False,
            search: Optional[str] = None,
            limit: int = 20,
            offset: int = 0,
        ):
            return await self.study_request_service.get_requests(
                type=type,
                subject=subject,
                method=method,
                verified_only=verified_only,
                search=search,
                limit=limit,
                offset=offset,
            )

        @app.post("/api/requests", summary="Tao yeu cau moi")
        async def create_request(body: StudyRequestPost, current_user: Any = current_user_dep):
            return await self.study_request_service.create_request(body, current_user)

        @app.patch("/api/requests/{request_id}", summary="Chinh sua yeu cau")
        async def update_request(
            request_id: int, body: UpdateStudyRequest, current_user: Any = current_user_dep
        ):
            return await self.study_request_service.update_request(
                request_id, body, current_user
            )

        @app.post("/api/requests/{request_id}/join", summary="Tham gia yeu cau")
        async def join_request(request_id: int, current_user: Any = current_user_dep):
            return await self.study_request_service.join_request(request_id, current_user)

        @app.get("/api/profile/me", summary="Lay profile cua minh")
        async def get_my_profile(current_user: Any = current_user_dep):
            return await self.profile_service.get_my_profile(current_user)

        async def update_my_profile(
            
            body: UpdateProfileRequest, current_user: Any = current_user_dep
        ):
            return await self.profile_service.update_my_profile(body, current_user)

        @app.get("/api/messages", summary="Lay danh sach hoi thoai")
        async def list_conversations(current_user: Any = current_user_dep, limit: int = 50):
            return await self.message_service.list_conversations(current_user, limit)

        @app.get("/api/messages/{other_user_id}", summary="Lay tin nhan voi mot nguoi")
        async def get_messages(
            other_user_id: str,
            current_user: Any = current_user_dep,
            limit: int = 50,
        ):
            return await self.message_service.get_messages(other_user_id, current_user, limit)

        @app.post("/api/messages", summary="Gửi tin nhắn")
        async def send_message(body: MessageRequest, current_user: Any = current_user_dep):
            return await self.message_service.send_message(body, current_user)

        @app.post("/api/messages/{other_user_id}/read", summary="Đánh dấu đã đọc")
        async def mark_messages_as_read(other_user_id: str, current_user: Any = current_user_dep):
            return await self.message_service.mark_as_read(other_user_id, current_user)

        @app.delete("/api/requests/{request_id}/join", summary="Roi khoi yeu cau")
        async def leave_request(request_id: int, current_user: Any = current_user_dep):
            return await self.study_request_service.leave_request(
                request_id, current_user
            )

        @app.get("/", summary="Health check")
        async def root():
            return await self.utility_service.root()

        @app.get("/api/health")
        async def health():
            return await self.utility_service.health()


study_buddy = StudyBuddyApplication()
app = study_buddy.app


if __name__ == "__main__":
    import uvicorn

    print("\n" + "=" * 55)
    print("  UIT Study Buddy - Backend API v2.0")
    print("=" * 55)
    print(f"  Supabase: {'Đã cấu hình' if study_buddy.supabase.enabled else 'Demo mode'}")
    print("  Xác thực: Email OTP (@gm.uit.edu.vn)")
    print("  API docs: http://localhost:8000/docs")
    print("=" * 55 + "\n")
    uvicorn.run("backend:app", host="0.0.0.0", port=8000, reload=True)
