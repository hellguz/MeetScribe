import uuid
from sqlmodel import SQLModel, Field

class User(SQLModel, table=True):
    id: uuid.UUID | None = Field(default_factory=uuid.uuid4, primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    is_active: bool = True
    customer_id: str | None = None  # stripe

class UserCreate(SQLModel):
    email: str
    password: str


