from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    openai_api_key: str
    app_password: str
    jwt_secret: str
    default_model: str = "gpt-4o-mini"
    chunk_size: int = 1000
    chunk_overlap: int = 200

    data_dir: str = "/app/data"
    uploads_dir: str = "/app/uploads"

    class Config:
        # Works from project root (Docker/docker-compose) AND from backend/ (local dev)
        env_file = (".env", "../.env")


settings = Settings()
