"""add deployments and project environment tables

Revision ID: 20260407_0003
Revises: 20260406_0002
Create Date: 2026-04-07 00:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260407_0003"
down_revision: Union[str, None] = "20260406_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "deployments",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("branch", sa.String(length=128), nullable=False, server_default="main"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_deployments_id", "deployments", ["id"])
    op.create_index("ix_deployments_project_id", "deployments", ["project_id"])
    op.create_index("ix_deployments_status", "deployments", ["status"])
    op.create_index("ix_deployments_started_at", "deployments", ["started_at"])
    op.create_index("ix_deployments_completed_at", "deployments", ["completed_at"])

    op.create_table(
        "project_environment",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("is_secret", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("project_id", "key", name="uq_project_environment_project_id_key"),
    )
    op.create_index("ix_project_environment_id", "project_environment", ["id"])
    op.create_index("ix_project_environment_project_id", "project_environment", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_project_environment_project_id", table_name="project_environment")
    op.drop_index("ix_project_environment_id", table_name="project_environment")
    op.drop_table("project_environment")

    op.drop_index("ix_deployments_completed_at", table_name="deployments")
    op.drop_index("ix_deployments_started_at", table_name="deployments")
    op.drop_index("ix_deployments_status", table_name="deployments")
    op.drop_index("ix_deployments_project_id", table_name="deployments")
    op.drop_index("ix_deployments_id", table_name="deployments")
    op.drop_table("deployments")
