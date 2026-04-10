from datetime import datetime

from config import SupabaseContext


class UtilityService:
    def __init__(self, supabase: SupabaseContext):
        self.supabase = supabase

    async def root(self):
        return {
            "status": "ok",
            "app": "UIT Study Buddy API v2.0",
            "supabase_connected": self.supabase.enabled,
            "verify_method": "Email OTP",
        }

    async def health(self):
        return {"status": "healthy", "timestamp": datetime.now().isoformat()}
