import os
from dataclasses import dataclass

from fastapi import HTTPException
from dotenv import load_dotenv

load_dotenv()

try:
    from supabase import create_client
except ImportError:
    print("supabase-py not installed. Run: pip install supabase")
    create_client = None


@dataclass
class AppConfig:
    supabase_url: str = os.getenv("SUPABASE_URL", "https://your-project.supabase.co")
    supabase_service_key: str = os.getenv("SUPABASE_SERVICE_KEY", "")
    supabase_anon_key: str = os.getenv("SUPABASE_ANON_KEY", "")
    frontend_url: str = os.getenv("FRONTEND_URL", "")

    @property
    def is_demo(self) -> bool:
        return not self.supabase_service_key or "your-project" in self.supabase_url


class SupabaseContext:
    def __init__(self, config: AppConfig):
        self.config = config
        self.admin = None
        if create_client and not config.is_demo:
            self.admin = create_client(config.supabase_url, config.supabase_service_key)

    @property
    def enabled(self) -> bool:
        return self.admin is not None

    def create_anon_client(self):
        if not create_client:
            raise HTTPException(status_code=500, detail="Supabase client chua duoc cai dat")
        return create_client(self.config.supabase_url, self.config.supabase_anon_key)
