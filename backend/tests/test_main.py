from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine
from typing import Generator

from app.main import app  # Assuming 'app' is the FastAPI instance in main.py
from app.models import Meeting, Feedback # Import models

# Database setup for testing
DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(DATABASE_URL, echo=False) # Turn off echo for cleaner test output

# Fixture to manage database creation and session
# This is a simplified setup. In a larger app, you might use Alembic for migrations.
def get_session_override() -> Generator[Session, None, None]:
    SQLModel.metadata.create_all(engine) # Create tables
    with Session(engine) as session:
        yield session
    SQLModel.metadata.drop_all(engine) # Clean up tables after tests if needed (or per test)

# This would typically be in a conftest.py or a shared fixtures file
# For now, keeping it simple here.
# If app.dependency_overrides is already used, this needs careful integration.
# For this exercise, assuming direct override for simplicity if 'get_db' is a direct dependency.
# However, main.py uses 'with Session(engine) as db:', so we don't override a 'get_db' dependency.
# Instead, we'll use this engine for test setup.

client = TestClient(app)

def create_test_meeting(db: Session, title: str = "Test Meeting") -> Meeting:
    meeting = Meeting(title=title)
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting

def test_create_feedback_success():
    # Setup: Create tables and get a session for test data setup
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        test_meeting = create_test_meeting(db)

        feedback_payload = {
            "meeting_id": str(test_meeting.id),
            "feedback_type": "spot_on",
            "feature_suggestion": None,
        }

        response = client.post("/api/feedback", json=feedback_payload)

        assert response.status_code == 201
        data = response.json()
        assert data["meeting_id"] == str(test_meeting.id)
        assert data["feedback_type"] == "spot_on"
        assert data["feature_suggestion"] is None
        assert "id" in data
        assert "created_at" in data

        # Verify in DB
        feedback_in_db = db.get(Feedback, data["id"])
        assert feedback_in_db is not None
        assert feedback_in_db.feedback_type == "spot_on"

    SQLModel.metadata.drop_all(engine) # Clean up

def test_create_feedback_meeting_not_found():
    SQLModel.metadata.create_all(engine) # Ensure tables exist

    feedback_payload = {
        "meeting_id": "non_existent_uuid_here", # Use a valid UUID format if server validates format
        "feedback_type": "too_short",
    }
    # A proper UUID that doesn't exist
    import uuid
    feedback_payload["meeting_id"] = str(uuid.uuid4())


    response = client.post("/api/feedback", json=feedback_payload)

    assert response.status_code == 404
    assert response.json()["detail"] == "Meeting not found"

    SQLModel.metadata.drop_all(engine) # Clean up

# Placeholder for stats tests - will add more if this structure works
def test_get_feedback_stats_empty():
    SQLModel.metadata.create_all(engine) # Ensure tables exist

    response = client.get("/api/feedback/stats")
    assert response.status_code == 200
    data = response.json()
    assert data["button_clicks"] == {}
    assert data["feature_suggestions"] == []

    SQLModel.metadata.drop_all(engine) # Clean up


def test_get_feedback_stats_with_data():
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        test_meeting = create_test_meeting(db, title="Stats Meeting")
        meeting_id_str = str(test_meeting.id)

        # Submit some feedback entries
        client.post("/api/feedback", json={"meeting_id": meeting_id_str, "feedback_type": "spot_on"})
        # To ensure different created_at for ordering, we might need a small delay or manual creation if tests run too fast
        # For now, relying on sequential processing order.
        import time
        time.sleep(0.01)
        client.post("/api/feedback", json={"meeting_id": meeting_id_str, "feedback_type": "feature_suggestion", "feature_suggestion": "First suggestion"})
        time.sleep(0.01)
        client.post("/api/feedback", json={"meeting_id": meeting_id_str, "feedback_type": "too_short"})
        time.sleep(0.01)
        client.post("/api/feedback", json={"meeting_id": meeting_id_str, "feedback_type": "spot_on"}) # Another spot_on
        time.sleep(0.01)
        client.post("/api/feedback", json={"meeting_id": meeting_id_str, "feedback_type": "feature_suggestion", "feature_suggestion": "Second suggestion, should be first in list"})

        # Call the stats endpoint
        response = client.get("/api/feedback/stats")
        assert response.status_code == 200
        data = response.json()

        # Assert button clicks
        assert len(data["button_clicks"]) == 2
        assert data["button_clicks"]["spot_on"] == 2
        assert data["button_clicks"]["too_short"] == 1
        assert "feature_suggestion" not in data["button_clicks"] # Ensure it's excluded

        # Assert feature suggestions
        assert len(data["feature_suggestions"]) == 2
        suggestions = data["feature_suggestions"]

        # Check ordering (most recent first) and content
        assert suggestions[0]["feature_suggestion"] == "Second suggestion, should be first in list"
        assert suggestions[0]["feedback_type"] == "feature_suggestion"
        assert suggestions[1]["feature_suggestion"] == "First suggestion"
        assert suggestions[1]["feedback_type"] == "feature_suggestion"

        # Check that created_at is present and suggests correct order (optional, depends on string comparison)
        assert suggestions[0]["created_at"] > suggestions[1]["created_at"]

    SQLModel.metadata.drop_all(engine)
