import os
from datetime import datetime
from uuid import uuid4
from sqlalchemy import (
    create_engine, Column, String, Integer, Boolean, DateTime, Text, ForeignKey
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

from .config import settings

os.makedirs(settings.data_dir, exist_ok=True)
os.makedirs(settings.uploads_dir, exist_ok=True)

DATABASE_URL = f"sqlite:///{settings.data_dir}/database.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    filename = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)
    file_path = Column(String, nullable=False)
    chunk_count = Column(Integer, default=0)
    chunk_size = Column(Integer, nullable=False)
    chunk_overlap = Column(Integer, nullable=False)
    splitter = Column(String, default="recursive")
    created_at = Column(DateTime, default=datetime.utcnow)

    chunks = relationship("Chunk", back_populates="document", cascade="all, delete-orphan")


class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    document_id = Column(String, ForeignKey("documents.id"), nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    char_count = Column(Integer, nullable=False)
    chroma_id = Column(String)
    has_overlap = Column(Boolean, default=False)
    overlap_chars = Column(Integer, default=0)

    document = relationship("Document", back_populates="chunks")


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)


def init_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        defaults = {
            "chunk_size": "1000",
            "chunk_overlap": "200",
            "splitter": "recursive",
        }
        for key, value in defaults.items():
            if not db.query(Setting).filter(Setting.key == key).first():
                db.add(Setting(key=key, value=value))
        db.commit()
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_settings_from_db(db) -> dict:
    rows = db.query(Setting).all()
    result = {r.key: r.value for r in rows}
    return {
        "chunk_size": int(result.get("chunk_size", 1000)),
        "chunk_overlap": int(result.get("chunk_overlap", 200)),
        "splitter": result.get("splitter", "recursive"),
    }
