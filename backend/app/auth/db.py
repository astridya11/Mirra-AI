import json
from pathlib import Path
from typing import Dict, List, Optional
from threading import Lock
from app.core.config import settings
from app.schemas import HistoricalProfile, UserAccount


class UserRepository:
    def __init__(self, file_path: str):
        self.file_path = Path(file_path)
        self._lock = Lock()
        self._by_email: Dict[str, UserAccount] = {}
        self._by_party_id: Dict[str, UserAccount] = {}
        self.load_users()

    def load_users(self) -> None:
        """Load users from users.json and populate lookup indexes."""
        with self._lock:
            self._by_email.clear()
            self._by_party_id.clear()

            if not self.file_path.exists():
                self.file_path.parent.mkdir(parents=True, exist_ok=True)
                self.file_path.write_text("[]", encoding="utf-8")

            with open(self.file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            for user_dict in data:
                user = UserAccount(**user_dict)
                self._by_email[user.email.lower()] = user
                self._by_party_id[user.party_id] = user

    def _persist(self) -> None:
        """Internal helper to write the in-memory cache back to users.json."""
        all_users = [user.model_dump() for user in self._by_party_id.values()]
        with open(self.file_path, "w", encoding="utf-8") as f:
            json.dump(all_users, f, indent=2)

    def get_by_email(self, email: str) -> Optional[UserAccount]:
        return self._by_email.get(email.lower())

    def get_by_party_id(self, party_id: str) -> Optional[UserAccount]:
        return self._by_party_id.get(party_id)

    def create_user(self, user: UserAccount) -> UserAccount:
        """Insert a new user account into memory and persist to disk."""
        with self._lock:
            if user.email.lower() in self._by_email:
                raise ValueError("Email already registered.")
            if user.party_id in self._by_party_id:
                raise ValueError("Party ID already exists.")

            self._by_email[user.email.lower()] = user
            self._by_party_id[user.party_id] = user
            self._persist()
            return user

    def generate_party_id(self, party_role: str) -> str:
        """Generate a new unique party ID (e.g., R-1093, D-5542, S-0002)."""
        prefix_map = {"RIDER": "R", "DRIVER": "D", "SUPPORT": "S"}
        prefix = prefix_map.get(party_role, "U")
        
        with self._lock:
            existing_ids = [
                int(pid.split("-")[1])
                for pid in self._by_party_id.keys()
                if pid.startswith(f"{prefix}-") and pid.split("-")[1].isdigit()
            ]
            next_num = (max(existing_ids) + 1) if existing_ids else 1000
            return f"{prefix}-{next_num}"

    def to_historical_profile(self, user: UserAccount) -> HistoricalProfile:
        """Sanitize UserAccount by dropping sensitive fields (e.g. password) for LLM context."""
        return HistoricalProfile(
            party=user.party,
            party_id=user.party_id,
            name=user.name,
            account_age_days=user.account_age_days,
            total_trips=user.total_trips,
            avg_rating=user.avg_rating,
            risk_score=user.risk_score,
            dispute_history_30d=user.dispute_history_30d,
            dispute_history_90d=user.dispute_history_90d,
            bad_faith_flag=user.bad_faith_flag,
            bad_faith_reason=user.bad_faith_reason,
        )


user_repo = UserRepository(settings.USERS_FILE_PATH)