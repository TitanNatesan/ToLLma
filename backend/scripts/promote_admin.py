"""Grant or revoke platform-administrator access.

Usage:
    docker compose exec -T backend python scripts/promote_admin.py user@example.com
    docker compose exec -T backend python scripts/promote_admin.py user@example.com --revoke

Platform admins see aggregated analytics only — never conversation content.
"""

import argparse
import sys

from sqlalchemy import select

from tollms.db.session import SessionLocal
from tollms.models.user import PlatformRole, User


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email")
    parser.add_argument("--revoke", action="store_true", help="demote to a regular user")
    args = parser.parse_args()

    role = PlatformRole.USER if args.revoke else PlatformRole.PLATFORM_ADMIN
    with SessionLocal() as db:
        user = db.scalar(
            select(User).where(User.email == args.email.strip().lower(), User.is_deleted.is_(False))
        )
        if user is None:
            print(f"user not found: {args.email}", file=sys.stderr)
            return 1
        user.platform_role = role
        db.commit()
        print(f"{args.email}: platform_role={role.value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
