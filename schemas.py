import re
from typing import Any, Optional

from pydantic import BaseModel, validator


class InputValidator:
    EMAIL_PATTERN = r"^[a-zA-Z0-9._%+\-]+@gm\.uit\.edu\.vn$"
    MSSV_PATTERN = r"^\d{8}$"
    OTP_PATTERN = r"^\d{6}$"

    @classmethod
    def validate_email(cls, value: str) -> str:
        if not re.match(cls.EMAIL_PATTERN, value):
            raise ValueError("Email phải có đuôi @gm.uit.edu.vn")
        return value

    @classmethod
    def validate_mssv(cls, value: str) -> str:
        if not re.match(cls.MSSV_PATTERN, value):
            raise ValueError("MSSV phải đúng 8 chữ số")
        return value

    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("Mật khẩu tối thiểu 8 ký tự")
        if not re.search(r"[a-zA-Z]", value):
            raise ValueError("Mật khẩu phải có ít nhất 1 chữ cái")
        if not re.search(r"[0-9]", value):
            raise ValueError("Mật khẩu phải có ít nhất 1 chữ số")
        return value

    @classmethod
    def validate_otp(cls, value: str) -> str:
        if not re.match(cls.OTP_PATTERN, value):
            raise ValueError("Mã OTP phải đúng 6 chữ số")
        return value

    @classmethod
    def validate_mssv_format(cls, mssv: str) -> dict[str, Any]:
        cls.validate_mssv(mssv)
        year_prefix = int(mssv[:2])
        if not (18 <= year_prefix <= 30):
            return {"valid": False, "error": f"Mã năm '{mssv[:4]}' không hợp lệ"}
        return {"valid": True, "message": "MSSV hợp lệ"}


class RegisterRequest(BaseModel):
    full_name: str
    email: str
    mssv: str
    password: str
    password_confirm: str

    @validator("email")
    def validate_email(cls, value):
        return InputValidator.validate_email(value)

    @validator("mssv")
    def validate_mssv(cls, value):
        return InputValidator.validate_mssv(value)

    @validator("password")
    def validate_password(cls, value):
        return InputValidator.validate_password(value)

    @validator("password_confirm")
    def passwords_match(cls, value, values):
        if "password" in values and value != values["password"]:
            raise ValueError("Mật khẩu xác nhận không khớp")
        return value


class LoginRequest(BaseModel):
    email: str
    password: str

    @validator("email")
    def validate_email(cls, value):
        return InputValidator.validate_email(value)


class ForgotPasswordRequest(BaseModel):
    email: str

    @validator("email")
    def validate_email(cls, value):
        return InputValidator.validate_email(value)


class VerifyResetOtpRequest(BaseModel):
    email: str
    token: str

    @validator("email")
    def validate_email(cls, value):
        return InputValidator.validate_email(value)

    @validator("token")
    def validate_token(cls, value):
        return InputValidator.validate_otp(value)


class UpdatePasswordRequest(BaseModel):
    password: str
    password_confirm: str

    @validator("password")
    def validate_password(cls, value):
        return InputValidator.validate_password(value)

    @validator("password_confirm")
    def passwords_match(cls, value, values):
        if "password" in values and value != values["password"]:
            raise ValueError("Mật khẩu xác nhận không khớp")
        return value


class OtpConfirmRequest(BaseModel):
    token: str

    @validator("token")
    def validate_token(cls, value):
        return InputValidator.validate_otp(value)


class StudyRequestPost(BaseModel):
    type: str
    subject: str
    method: str
    location_or_link: str
    time: str
    slots: int
    note: Optional[str] = None
    tutor_role: Optional[str] = None

    @validator("type")
    def validate_type(cls, value):
        if value not in ("study", "tutor"):
            raise ValueError("type phải là 'study' hoặc 'tutor'")
        return value

    @validator("method")
    def validate_method(cls, value):
        if value not in ("online", "offline"):
            raise ValueError("method phải là 'online' hoặc 'offline'")
        return value

    @validator("slots")
    def validate_slots(cls, value):
        if value < 2 or value > 50:
            raise ValueError("Số lượng người từ 2 đến 50")
        return value


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None


class MessageRequest(BaseModel):
    receiver_id: str
    content: str
