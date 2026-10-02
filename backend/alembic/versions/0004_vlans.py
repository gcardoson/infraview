"""vlans register

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-02 20:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vlans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("vlan_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("subnet", sa.String(length=64), nullable=True),
        sa.Column("gateway_ip", sa.String(length=45), nullable=True),
        sa.Column("dhcp", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "active", "spare", "maintenance", "decommissioned", name="lifecycle_status", create_type=False
            ),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "vlan_id", name="uq_vlans_site_vlan"),
    )
    op.create_index(op.f("ix_vlans_site_id"), "vlans", ["site_id"], unique=False)
    # Start the register with the VLANs already listed on each site's internet links.
    op.execute(
        """
        INSERT INTO vlans (site_id, vlan_id, name, subnet, status)
        SELECT DISTINCT ON (l.site_id, (v->>'vlan_id')::int)
               l.site_id, (v->>'vlan_id')::int,
               COALESCE(NULLIF(v->>'name', ''), 'VLAN ' || (v->>'vlan_id')),
               NULLIF(v->>'subnet', ''), 'active'
        FROM internet_links l, json_array_elements(l.vlans) v
        ORDER BY l.site_id, (v->>'vlan_id')::int, l.id
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_vlans_site_id"), table_name="vlans")
    op.drop_table("vlans")
