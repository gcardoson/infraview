"""rooms, topologies and clusters

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-02 21:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.initial_data import DEFAULT_ROOM, initial_for

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    rooms = op.create_table(
        "rooms",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.Enum("cpd", "rack", name="room_kind"), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("building", sa.String(length=200), nullable=True),
        sa.Column("node_id", sa.String(length=64), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("cameras", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("cooling", sa.String(length=200), nullable=True),
        sa.Column("access", sa.String(length=120), nullable=True),
        sa.Column("power_capacity_kw", sa.Float(), nullable=True),
        sa.Column("racks", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "code", name="uq_rooms_site_code"),
    )
    op.create_index(op.f("ix_rooms_site_id"), "rooms", ["site_id"], unique=False)

    topologies = op.create_table(
        "topologies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("revision", sa.String(length=32), nullable=True),
        sa.Column("date", sa.String(length=32), nullable=True),
        sa.Column("author", sa.String(length=120), nullable=True),
        sa.Column("document", sa.JSON(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id"),
    )

    clusters = op.create_table(
        "clusters",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("vcenter", sa.String(length=200), nullable=True),
        sa.Column("ha_enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("drs", sa.String(length=32), nullable=True),
        sa.Column("document", sa.JSON(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id"),
    )

    # Existing sites keep what the screens showed; any other site gets a CPD so it has at least one room.
    bind = op.get_bind()
    for site_id, code in bind.execute(sa.text("SELECT id, code FROM sites")).all():
        data = initial_for(code)
        site_rooms = data["rooms"] if data else [DEFAULT_ROOM]
        op.bulk_insert(rooms, [{**room, "site_id": site_id} for room in site_rooms])
        if data and data["topology"]:
            op.bulk_insert(topologies, [{**data["topology"], "site_id": site_id}])
        if data and data["cluster"]:
            op.bulk_insert(clusters, [{**data["cluster"], "site_id": site_id}])


def downgrade() -> None:
    op.drop_table("clusters")
    op.drop_table("topologies")
    op.drop_index(op.f("ix_rooms_site_id"), table_name="rooms")
    op.drop_table("rooms")
    sa.Enum(name="room_kind").drop(op.get_bind(), checkfirst=True)
