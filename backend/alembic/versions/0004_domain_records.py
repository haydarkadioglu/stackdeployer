"""add project domain records table

Revision ID: 20260407_0004
Revises: 20260407_0003
Create Date: 2026-04-07 00:30:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260407_0004"
down_revision: Union[str, None] = "20260407_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_domain_records",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("record_type", sa.String(length=8), nullable=False),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.Column("value", sa.String(length=255), nullable=False),
        sa.Column("ttl", sa.Integer(), nullable=False, server_default="300"),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("project_id", "record_type", "host", name="uq_project_domain_records_project_type_host"),
    )
    op.create_index("ix_project_domain_records_id", "project_domain_records", ["id"])
    op.create_index("ix_project_domain_records_project_id", "project_domain_records", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_project_domain_records_project_id", table_name="project_domain_records")
    op.drop_index("ix_project_domain_records_id", table_name="project_domain_records")
    op.drop_table("project_domain_records")
