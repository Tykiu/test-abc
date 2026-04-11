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
            profile_res = self.supabase.admin.table("profiles").select("mssv").eq("id", current_user.id).single().execute()
            if not profile_res.data or not profile_res.data.get("mssv"):
                raise HTTPException(status_code=400, detail="Không tìm thấy MSSV của bạn")
            
            mssv = profile_res.data["mssv"]
            uit_email = f"{mssv}@gm.uit.edu.vn"

            anon_client = self.supabase.create_anon_client()
            anon_client.auth.sign_in_with_otp(
                {"email": uit_email, "options": {"should_create_user": True}}
            )
            return {
                "success": True,
                "message": f"Đã gửi mã OTP đến {uit_email}. Kiểm tra hộp thư trong 10 phút.",
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Không thể gửi OTP: {exc}")

    async def confirm_otp(self, body: OtpConfirmRequest, current_user: Any):
        if not self.supabase.enabled:
            return {
                "success": True,
                "verified": True,
                "message": "Demo: Xác thực thành công! Email trường đã được xác nhận.",
            }

        try:
            profile_res = self.supabase.admin.table("profiles").select("mssv").eq("id", current_user.id).single().execute()
            if not profile_res.data or not profile_res.data.get("mssv"):
                raise HTTPException(status_code=400, detail="Không tìm thấy MSSV của bạn")
            
            mssv = profile_res.data["mssv"]
            uit_email = f"{mssv}@gm.uit.edu.vn"

            anon_client = self.supabase.create_anon_client()
            try:
                response = anon_client.auth.verify_otp(
                    {"email": uit_email, "token": body.token, "type": "email"}
                )
            except Exception:
                try:
                    response = anon_client.auth.verify_otp(
                        {"email": uit_email, "token": body.token, "type": "magiclink"}
                    )
                except Exception:
                    raise HTTPException(status_code=400, detail="Mã OTP không đúng hoặc đã hết hạn. Vui lòng thử lại.")

            otp_user_id = response.user.id
            profile_check = self.supabase.admin.table("profiles").select("id").eq("id", otp_user_id).execute()
            if not profile_check.data:
                try:
                    self.supabase.admin.auth.admin.delete_user(otp_user_id)
                except Exception:
                    pass

            self.supabase.admin.table("profiles").update({"is_verified": True}).eq(
                "id", current_user.id
            ).execute()
            return {
                "success": True,
                "verified": True,
                "message": "Xác thực thành công! Email trường đã được xác nhận.",
            }
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Mã OTP không đúng hoặc đã hết hạn. Vui lòng thử lại.",
            )
