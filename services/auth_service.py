from typing import Any

from fastapi import Header, HTTPException

from config import SupabaseContext
from schemas import (
    ForgotPasswordRequest,
    InputValidator,
    LoginRequest,
    RegisterRequest,
    UpdatePasswordRequest,
)


class AuthService:
    def __init__(self, supabase: SupabaseContext):
        self.supabase = supabase

    async def get_current_user(self, authorization: str = Header(None)):
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Token khong hop le")

        token = authorization.replace("Bearer ", "")
        if not self.supabase.enabled:
            return {"id": "demo-user", "email": "demo@gm.uit.edu.vn"}

        try:
            user_response = self.supabase.admin.auth.get_user(token)
            return user_response.user
        except Exception:
            raise HTTPException(status_code=401, detail="Token het han hoac khong hop le")

    async def register(self, body: RegisterRequest):
        mssv_check = InputValidator.validate_mssv_format(body.mssv)
        if not mssv_check["valid"]:
            raise HTTPException(status_code=400, detail=mssv_check["error"])

        if not self.supabase.enabled:
            return {
                "success": True,
                "message": "Demo mode: Dang ky thanh cong",
                "user": {"email": body.email, "mssv": body.mssv, "full_name": body.full_name},
            }

        try:
            auth_response = self.supabase.admin.auth.admin.create_user(
                {
                    "email": body.email,
                    "password": body.password,
                    "email_confirm": True,
                    "user_metadata": {"full_name": body.full_name, "mssv": body.mssv},
                }
            )
            user_id = auth_response.user.id
            self.supabase.admin.table("profiles").insert(
            {
                "id": user_id,
                "full_name": body.full_name,
                "mssv": body.mssv,
                "is_verified": False,
                "bio": "",
            }
).execute()
            return {
                "success": True,
                "message": f"Dang ky thanh cong! Chao mung {body.full_name}.",
                "user_id": user_id,
            }
        except Exception as exc:
            error_msg = str(exc)
            if "already registered" in error_msg.lower() or "duplicate" in error_msg.lower():
                raise HTTPException(status_code=409, detail="Email nay da duoc dang ky")
            raise HTTPException(status_code=500, detail=f"Loi dang ky: {error_msg}")

    async def login(self, body: LoginRequest):
        if not self.supabase.enabled:
            return {
                "success": True,
                "message": "Demo mode login",
                "access_token": "demo-token-" + body.email,
                "user": {"email": body.email},
                "profile": {"full_name": "Demo User", "mssv": "22521001", "is_verified": True},
            }

        try:
            anon_client = self.supabase.create_anon_client()
            response = anon_client.auth.sign_in_with_password(
                {"email": body.email, "password": body.password}
            )
            profile = (
                self.supabase.admin.table("profiles")
                .select("*")
                .eq("id", response.user.id)
                .single()
                .execute()
            )
            return {
                "success": True,
                "access_token": response.session.access_token,
                "refresh_token": response.session.refresh_token,
                "user": {"id": response.user.id, "email": response.user.email},
                "profile": profile.data,
            }
        except Exception:
            raise HTTPException(status_code=401, detail="Email hoac mat khau khong dung")

    async def forgot_password(self, body: ForgotPasswordRequest):
        if not self.supabase.enabled:
            return {
                "success": True,
                "message": "Demo mode: Da gia lap gui email dat lai mat khau",
            }

        try:
            anon_client = self.supabase.create_anon_client()
            if self.supabase.config.frontend_url:
                anon_client.auth.reset_password_email(
                    body.email, {"redirect_to": self.supabase.config.frontend_url}
                )
            else:
                anon_client.auth.reset_password_email(body.email)
            return {
                "success": True,
                "message": "Da gui email dat lai mat khau. Vui long kiem tra hop thu.",
            }
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Khong the gui email dat lai mat khau: {exc}",
            )

    async def update_password(self, body: UpdatePasswordRequest, current_user: Any):
        if not self.supabase.enabled:
            return {
                "success": True,
                "message": "Demo mode: Da cap nhat mat khau moi",
            }

        try:
            self.supabase.admin.auth.admin.update_user_by_id(
                current_user.id,
                {"password": body.password},
            )
            return {
                "success": True,
                "message": "Da dat lai mat khau thanh cong. Ban co the dang nhap lai.",
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Khong the cap nhat mat khau: {exc}")
