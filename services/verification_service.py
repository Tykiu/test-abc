import random
from typing import Any

from fastapi import HTTPException

from config import SupabaseContext
from schemas import OtpConfirmRequest


class VerificationService:
    def __init__(self, supabase: SupabaseContext):
        self.supabase = supabase

    async def send_otp(self, current_user: Any):
        if not self.supabase.enabled:
            return {
                "success": True,
                "message": "Demo mode: OTP da duoc gia lap",
                "demo_otp": str(random.randint(100000, 999999)),
            }

        try:
            user_res = self.supabase.admin.auth.admin.get_user_by_id(current_user.id)
            email = user_res.user.email
            anon_client = self.supabase.create_anon_client()
            anon_client.auth.sign_in_with_otp(
                {"email": email, "options": {"should_create_user": False}}
            )
            return {
                "success": True,
                "message": f"Da gui ma OTP den {email}. Kiem tra hop thu trong 10 phut.",
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Khong the gui OTP: {exc}")

    async def confirm_otp(self, body: OtpConfirmRequest, current_user: Any):
        if not self.supabase.enabled:
            return {
                "success": True,
                "verified": True,
                "message": "Demo: Xac thuc thanh cong! Email truong da duoc xac nhan.",
            }

        try:
            user_res = self.supabase.admin.auth.admin.get_user_by_id(current_user.id)
            email = user_res.user.email
            anon_client = self.supabase.create_anon_client()
            response = anon_client.auth.verify_otp(
                {"email": email, "token": body.token, "type": "email"}
            )
            if not response.user:
                raise HTTPException(status_code=400, detail="Ma OTP khong hop le hoac da het han")

            self.supabase.admin.table("profiles").update({"is_verified": True}).eq(
                "id", current_user.id
            ).execute()
            return {
                "success": True,
                "verified": True,
                "message": "Xac thuc thanh cong! Email truong da duoc xac nhan.",
            }
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Ma OTP khong dung hoac da het han. Vui long thu lai.",
            )
