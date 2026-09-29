"""site coordinates

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-29 11:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sites", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("sites", sa.Column("longitude", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("sites", "longitude")
    op.drop_column("sites", "latitude")
