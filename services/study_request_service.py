from typing import Any, Optional

from fastapi import HTTPException

from config import SupabaseContext
from schemas import StudyRequestPost


class StudyRequestService:
    def __init__(self, supabase: SupabaseContext):
        self.supabase = supabase

    async def get_requests(
        self,
        type: Optional[str] = None,
        subject: Optional[str] = None,
        method: Optional[str] = None,
        verified_only: bool = False,
        search: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ):
        if not self.supabase.enabled:
            return {"data": [], "count": 0, "message": "Demo mode - du lieu tu frontend"}

        try:
            query = (
                self.supabase.admin.table("study_requests")
                .select("*, profiles(full_name, mssv, is_verified, bio, avatar_url)")
                .eq("status", "open")
                .order("created_at", desc=True)
            )

            if type:
                query = query.eq("type", type)
            if method:
                query = query.eq("method", method)
            if subject:
                query = query.ilike("subject", f"%{subject}%")
            if search:
                query = query.or_(f"subject.ilike.%{search}%,note.ilike.%{search}%")

            response = query.range(offset, offset + limit - 1).execute()
            data = response.data or []
            if verified_only:
                data = [item for item in data if item.get("profiles", {}).get("is_verified")]
            return {"data": data, "count": len(data)}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    async def create_request(self, body: StudyRequestPost, current_user: Any):
        if body.type == "tutor" and self.supabase.enabled:
            profile_res = (
                self.supabase.admin.table("profiles")
                .select("is_verified")
                .eq("id", current_user.id)
                .single()
                .execute()
            )
            if not profile_res.data or not profile_res.data.get("is_verified"):
                raise HTTPException(
                    status_code=403,
                    detail="Ban can xac thuc email truong de su dung tinh nang Gia su",
                )

        if not self.supabase.enabled:
            return {"success": True, "message": "Demo mode: Tao bai dang thanh cong"}

        try:
            payload = {
                "user_id": current_user.id,
                "type": body.type,
                "subject": body.subject,
                "method": body.method,
                "location_or_link": body.location_or_link,
                "time": body.time,
                "slots": body.slots,
                "current_slots": 0,
                "note": body.note,
                "status": "open",
                "tutor_role": body.tutor_role,
            }
            response = self.supabase.admin.table("study_requests").insert(payload).execute()
            return {"success": True, "data": response.data[0] if response.data else None}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    async def join_request(self, request_id: int, current_user: Any):
        if not self.supabase.enabled:
            return {"success": True, "message": "Demo: Tham gia thanh cong"}

        try:
            req = (
                self.supabase.admin.table("study_requests")
                .select("*")
                .eq("id", request_id)
                .single()
                .execute()
            )
            if not req.data:
                raise HTTPException(status_code=404, detail="Khong tim thay bai dang")

            request_data = req.data
            if request_data["user_id"] == current_user.id:
                raise HTTPException(status_code=400, detail="Ban khong the tham gia bai dang cua chinh minh")
            if request_data["status"] == "closed":
                raise HTTPException(status_code=400, detail="Bai dang nay da day cho")

            existing_member = (
                self.supabase.admin.table("study_request_members")
                .select("id")
                .eq("request_id", request_id)
                .eq("user_id", current_user.id)
                .limit(1)
                .execute()
            )
            if existing_member.data:
                raise HTTPException(status_code=409, detail="Ban da tham gia bai dang nay roi")

            self.supabase.admin.table("study_request_members").insert(
                {"request_id": request_id, "user_id": current_user.id}
            ).execute()

            new_slots = (request_data["current_slots"] or 0) + 1
            new_status = "closed" if new_slots >= request_data["slots"] else "open"

            self.supabase.admin.table("study_requests").update(
                {"current_slots": new_slots, "status": new_status}
            ).eq("id", request_id).execute()

            return {
                "success": True,
                "message": "Tham gia thanh cong!",
                "current_slots": new_slots,
                "status": new_status,
                "is_full": new_status == "closed",
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
