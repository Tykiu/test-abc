from typing import Any

from fastapi import HTTPException

from config import SupabaseContext
from schemas import MessageRequest


class MessageService:
    def __init__(self, supabase: SupabaseContext):
        self.supabase = supabase

    async def list_conversations(self, current_user: Any, limit: int = 50):
        if not self.supabase.enabled:
            return {"data": []}

        try:
            my_id = current_user.id
            response = (
                self.supabase.admin.table("messages")
                .select("sender_id, receiver_id, content, created_at")
                .or_(f"sender_id.eq.{my_id},receiver_id.eq.{my_id}")
                .order("created_at", desc=True)
                .limit(max(limit * 5, 100))
                .execute()
            )

            messages = response.data or []
            latest_by_user = {}
            other_user_ids = set()

            for item in messages:
                other_user_id = (
                    item["receiver_id"] if item["sender_id"] == my_id else item["sender_id"]
                )
                if other_user_id in latest_by_user:
                    continue
                latest_by_user[other_user_id] = {
                    "user_id": other_user_id,
                    "last_message": item.get("content", ""),
                    "last_time": item.get("created_at"),
                }
                other_user_ids.add(other_user_id)
                if len(latest_by_user) >= limit:
                    break

            profiles_map = {}
            if other_user_ids:
                profile_res = (
                    self.supabase.admin.table("profiles")
                    .select("id, full_name, mssv, avatar_url, is_verified")
                    .in_("id", list(other_user_ids))
                    .execute()
                )
                profiles_map = {
                    profile["id"]: profile for profile in (profile_res.data or []) if profile.get("id")
                }

            conversations = []
            for user_id, item in latest_by_user.items():
                profile = profiles_map.get(user_id, {})
                conversations.append(
                    {
                        "user_id": user_id,
                        "full_name": profile.get("full_name") or "Nguoi dung",
                        "mssv": profile.get("mssv") or "",
                        "avatar_url": profile.get("avatar_url"),
                        "is_verified": bool(profile.get("is_verified")),
                        "last_message": item["last_message"],
                        "last_time": item["last_time"],
                    }
                )

            return {"data": conversations}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    async def get_messages(self, other_user_id: str, current_user: Any, limit: int = 50):
        if not self.supabase.enabled:
            return {
                "data": [
                    {
                        "sender_id": "other",
                        "content": "Xin chao! Ban muon hoc nhom khong?",
                        "created_at": "2025-01-01T14:00:00",
                    },
                    {
                        "sender_id": "me",
                        "content": "Co chu! Minh dang can nguoi hoc cung.",
                        "created_at": "2025-01-01T14:05:00",
                    },
                ]
            }

        try:
            my_id = current_user.id
            response = (
                self.supabase.admin.table("messages")
                .select("*")
                .or_(
                    f"and(sender_id.eq.{my_id},receiver_id.eq.{other_user_id}),"
                    f"and(sender_id.eq.{other_user_id},receiver_id.eq.{my_id})"
                )
                .order("created_at")
                .limit(limit)
                .execute()
            )
            return {"data": response.data or []}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    async def send_message(self, body: MessageRequest, current_user: Any):
        if not self.supabase.enabled:
            return {"success": True, "message": "Demo: Tin nhan da gui"}

        try:
            response = self.supabase.admin.table("messages").insert(
                {
                    "sender_id": current_user.id,
                    "receiver_id": body.receiver_id,
                    "content": body.content,
                }
            ).execute()
            return {"success": True, "data": response.data[0] if response.data else None}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
