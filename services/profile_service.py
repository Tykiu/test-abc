from typing import Any

from fastapi import HTTPException

from config import SupabaseContext
from schemas import UpdateProfileRequest


class ProfileService:
    def __init__(self, supabase: SupabaseContext):
        self.supabase = supabase

    async def get_my_profile(self, current_user: Any):
        if not self.supabase.enabled:
            return {
                "id": "demo",
                "full_name": "Demo User",
                "mssv": "22521001",
                "is_verified": True,
                "bio": "Demo account",
            }

        response = (
            self.supabase.admin.table("profiles")
            .select("*")
            .eq("id", current_user.id)
            .single()
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Profile khong ton tai")
        return response.data

    async def update_my_profile(self, body: UpdateProfileRequest, current_user: Any):
        if not self.supabase.enabled:
            return {"success": True, "message": "Demo: Da cap nhat"}

        update_data = {}
        if body.full_name:
            update_data["full_name"] = body.full_name
        if body.bio is not None:
            update_data["bio"] = body.bio
        if body.avatar_url is not None:
            update_data["avatar_url"] = body.avatar_url
        if not update_data:
            raise HTTPException(status_code=400, detail="Khong co du lieu de cap nhat")

        self.supabase.admin.table("profiles").update(update_data).eq("id", current_user.id).execute()
        return {"success": True, "message": "Da cap nhat thong tin thanh cong"}
