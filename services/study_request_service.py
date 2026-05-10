from typing import Any, Optional

from fastapi import HTTPException

from config import SupabaseContext
from schemas import StudyRequestPost, UpdateStudyRequest


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
            print(f"DEBUG: get_requests found {len(data)} items")
            
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
                    detail="Bạn cần xác thực email trường để sử dụng tính năng Gia sư",
                )

        if not self.supabase.enabled:
            return {"success": True, "message": "Demo mode: Tạo bài đăng thành công"}

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
            if body.content: payload["content"] = body.content
            if body.drive_link: payload["drive_link"] = body.drive_link
            if body.session_date: payload["session_date"] = body.session_date
            if body.session_start: payload["session_start"] = body.session_start
            if body.session_end: payload["session_end"] = body.session_end
            if body.session_start_datetime: payload["session_start_datetime"] = body.session_start_datetime
            
            response = self.supabase.admin.table("study_requests").insert(payload).execute()
            if response.data:
                print(f"DEBUG: Created request with ID: {response.data[0].get('id')}")
            return {"success": True, "data": response.data[0] if response.data else None}
        except Exception as exc:
            print("ERROR IN CREATE_REQUEST:", str(exc))
            raise HTTPException(status_code=500, detail=str(exc))

    async def update_request(
        self, request_id: int, body: UpdateStudyRequest, current_user: Any
    ):
        if not self.supabase.enabled:
            return {"success": True, "message": "Demo mode: Cập nhật thành công"}

        try:
            req_res = (
                self.supabase.admin.table("study_requests")
                .select("user_id")
                .eq("id", request_id)
                .single()
                .execute()
            )
            if not req_res.data:
                raise HTTPException(status_code=404, detail="Không tìm thấy bài đăng")
            if req_res.data["user_id"] != current_user.id:
                raise HTTPException(
                    status_code=403, detail="Bạn không có quyền chỉnh sửa bài đăng này"
                )

            update_data = body.dict(exclude_unset=True)
            if not update_data:
                raise HTTPException(status_code=400, detail="Không có thông tin để cập nhật")

            # Xóa hoặc chuyển giá trị rỗng thành None cho các trường thời gian
            for time_field in ["session_end", "session_start", "session_date", "session_start_datetime"]:
                if time_field in update_data and update_data[time_field] == "":
                    update_data[time_field] = None

            response = self.supabase.admin.table("study_requests").update(update_data).eq("id", request_id).execute()
            return {"success": True, "data": response.data[0] if response.data else None}
        except HTTPException:
            raise
        except Exception as exc:
            print("ERROR IN UPDATE_REQUEST:", str(exc))
            raise HTTPException(status_code=500, detail=str(exc))

    async def delete_request(self, request_id: int, current_user: Any):
        if not self.supabase.enabled:
            return {"success": True, "message": "Demo mode: Xóa thành công"}

        try:
            req_res = (
                self.supabase.admin.table("study_requests")
                .select("user_id")
                .eq("id", request_id)
                .single()
                .execute()
            )
            if not req_res.data:
                raise HTTPException(status_code=404, detail="Không tìm thấy bài đăng")
            if req_res.data["user_id"] != current_user.id:
                raise HTTPException(status_code=403, detail="Bạn không có quyền xóa bài đăng này")

            self.supabase.admin.table("study_requests").delete().eq("id", request_id).execute()
            return {"success": True, "message": "Xóa bài đăng thành công"}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    async def join_request(self, request_id: int, current_user: Any):
        if not self.supabase.enabled:
            return {"success": True, "message": "Demo: Tham gia thành công"}

        try:
            req = (
                self.supabase.admin.table("study_requests")
                .select("*")
                .eq("id", request_id)
                .single()
                .execute()
            )
            if not req.data:
                raise HTTPException(status_code=404, detail="Không tìm thấy bài đăng")

            request_data = req.data
            if request_data["user_id"] == current_user.id:
                raise HTTPException(status_code=400, detail="Bạn không thể tham gia bài đăng của chính mình")
            if request_data["status"] == "closed":
                raise HTTPException(status_code=400, detail="Bài đăng này đã đầy chỗ")

            existing_member = (
                self.supabase.admin.table("study_request_members")
                .select("id")
                .eq("request_id", request_id)
                .eq("user_id", current_user.id)
                .limit(1)
                .execute()
            )
            if existing_member.data:
                raise HTTPException(status_code=409, detail="Bạn đã tham gia bài đăng này rồi")

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
                "message": "Tham gia thành công!",
                "current_slots": new_slots,
                "status": new_status,
                "is_full": new_status == "closed",
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    async def leave_request(self, request_id: int, current_user: Any):
        if not self.supabase.enabled:
            return {"success": True, "message": "Demo: Rời nhóm thành công"}

        try:
            member_res = (
                self.supabase.admin.table("study_request_members")
                .select("id")
                .eq("request_id", request_id)
                .eq("user_id", current_user.id)
                .limit(1)
                .execute()
            )
            if not member_res.data:
                raise HTTPException(status_code=404, detail="Bạn chưa tham gia bài đăng này")

            self.supabase.admin.table("study_request_members").delete().eq("id", member_res.data[0]["id"]).execute()

            req = self.supabase.admin.table("study_requests").select("current_slots, slots").eq("id", request_id).single().execute()
            if not req.data:
                return {"success": True, "message": "Rời nhóm thành công nhưng không tìm thấy bài đăng gốc."}

            new_slots = max(0, (req.data["current_slots"] or 0) - 1)
            new_status = "open"

            self.supabase.admin.table("study_requests").update(
                {"current_slots": new_slots, "status": new_status}
            ).eq("id", request_id).execute()

            return {"success": True, "message": "Rời nhóm thành công!"}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    async def remove_member(self, request_id: int, user_id: str, current_user: Any):
        if not self.supabase.enabled:
            return {"success": True, "message": "Demo: Xóa thành viên thành công"}

        try:
            # 1. Kiểm tra xem người dùng hiện tại có phải là chủ bài đăng không
            req = self.supabase.admin.table("study_requests").select("user_id, current_slots").eq("id", request_id).single().execute()
            if not req.data:
                raise HTTPException(status_code=404, detail="Không tìm thấy bài đăng")
            if req.data["user_id"] != current_user.id:
                raise HTTPException(status_code=403, detail="Chỉ người tạo mới có quyền xóa thành viên")

            # 2. Tìm ID của bảng kết nối
            member_res = (
                self.supabase.admin.table("study_request_members")
                .select("id")
                .eq("request_id", request_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            if not member_res.data:
                raise HTTPException(status_code=404, detail="Thành viên không nằm trong bài đăng này")

            # 3. Xóa thành viên và cập nhật lại số lượng (slots)
            self.supabase.admin.table("study_request_members").delete().eq("id", member_res.data[0]["id"]).execute()
            new_slots = max(0, (req.data["current_slots"] or 0) - 1)
            self.supabase.admin.table("study_requests").update({"current_slots": new_slots, "status": "open"}).eq("id", request_id).execute()

            return {"success": True, "message": "Đã xóa thành viên khỏi nhóm"}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    async def get_history(self, current_user: Any):
        if not self.supabase.enabled:
            return {"success": True, "data": []}

        try:
            created_reqs = (
                self.supabase.admin.table("study_requests")
                .select("*, profiles(full_name, mssv, is_verified, bio, avatar_url)")
                .eq("user_id", current_user.id)
                .order("created_at", desc=True)
                .execute()
            )
            created_data = created_reqs.data or []

            joined_members = (
                self.supabase.admin.table("study_request_members")
                .select("request_id")
                .eq("user_id", current_user.id)
                .execute()
            )
            
            joined_data = []
            if joined_members.data:
                req_ids = [m["request_id"] for m in joined_members.data]
                if req_ids:
                    joined_reqs = (
                        self.supabase.admin.table("study_requests")
                        .select("*, profiles(full_name, mssv, is_verified, bio, avatar_url)")
                        .in_("id", req_ids)
                        .execute()
                    )
                    joined_data = joined_reqs.data or []

            all_reqs_dict = {r["id"]: r for r in created_data + joined_data}
            
            all_req_ids = list(all_reqs_dict.keys())
            if all_req_ids:
                members_res = (
                    self.supabase.admin.table("study_request_members")
                    .select("request_id, profiles(id, full_name, avatar_url, mssv)")
                    .in_("request_id", all_req_ids)
                    .execute()
                )
                
                members_by_req_id = {}
                if members_res.data:
                    for member in members_res.data:
                        req_id = member["request_id"]
                        if req_id not in members_by_req_id:
                            members_by_req_id[req_id] = []
                        if member.get("profiles"):
                            members_by_req_id[req_id].append(member["profiles"])

                for req_id, req_data in all_reqs_dict.items():
                    creator_id = req_data.get("user_id")
                    req_data["members"] = [m for m in members_by_req_id.get(req_id, []) if m.get("id") != creator_id]

            sorted_reqs = sorted(all_reqs_dict.values(), key=lambda x: x.get("created_at", ""), reverse=True)
            print(f"DEBUG: get_history returning {len(sorted_reqs)} items")

            return {"success": True, "data": sorted_reqs}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
