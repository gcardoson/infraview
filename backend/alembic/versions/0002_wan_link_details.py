"""wan link details

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-28 22:44:22.646395
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    link_role = sa.Enum("primary", "secondary", "backup", name="link_role")
    link_role.create(op.get_bind(), checkfirst=True)
    op.add_column("internet_links", sa.Column("role", link_role, nullable=False, server_default="primary"))
    op.add_column("internet_links", sa.Column("netmask", sa.String(length=64), nullable=True))
    op.add_column("internet_links", sa.Column("gateway_ip", sa.String(length=45), nullable=True))
    op.add_column(
        "internet_links",
        sa.Column("nat_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column("internet_links", sa.Column("sdwan_device", sa.String(length=120), nullable=True))
    op.add_column("internet_links", sa.Column("sdwan_port", sa.String(length=64), nullable=True))
    op.add_column(
        "internet_links", sa.Column("vlans", sa.JSON(), nullable=False, server_default=sa.text("'[]'"))
    )


def downgrade() -> None:
    op.drop_column("internet_links", "vlans")
    op.drop_column("internet_links", "sdwan_port")
    op.drop_column("internet_links", "sdwan_device")
    op.drop_column("internet_links", "nat_enabled")
    op.drop_column("internet_links", "gateway_ip")
    op.drop_column("internet_links", "netmask")
    op.drop_column("internet_links", "role")
    sa.Enum(name="link_role").drop(op.get_bind(), checkfirst=True)
