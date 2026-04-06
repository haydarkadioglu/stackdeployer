"""initial schema

Revision ID: 20260406_0001
Revises: 
Create Date: 2026-04-06 00:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260406_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("git_url", sa.String(length=1000), nullable=False),
        sa.Column("local_path", sa.String(length=1000), nullable=False),
        sa.Column("domain", sa.String(length=255), nullable=True),
        sa.Column("internal_port", sa.Integer(), nullable=False),
        sa.Column("tech_stack", sa.String(length=64), nullable=False),
        sa.Column("build_command", sa.Text(), nullable=True),
        sa.Column("start_command", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.create_index("ix_projects_id", "projects", ["id"])
    op.create_index("ix_projects_name", "projects", ["name"], unique=True)
    op.create_index("ix_projects_local_path", "projects", ["local_path"], unique=True)
    op.create_index("ix_projects_domain", "projects", ["domain"], unique=True)
    op.create_index("ix_projects_internal_port", "projects", ["internal_port"])
    op.create_index("ix_projects_tech_stack", "projects", ["tech_stack"])
    op.create_index("ix_projects_status", "projects", ["status"])

    op.create_table(
        "logs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("level", sa.String(length=20), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_logs_id", "logs", ["id"])
    op.create_index("ix_logs_project_id", "logs", ["project_id"])
    op.create_index("ix_logs_level", "logs", ["level"])
    op.create_index("ix_logs_created_at", "logs", ["created_at"])

    op.create_table(
        "settings",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("is_secret", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.create_index("ix_settings_id", "settings", ["id"])
    op.create_index("ix_settings_key", "settings", ["key"], unique=True)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("username", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_superuser", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.drop_index("ix_users_id", table_name="users")
    op.drop_table("users")

    op.drop_index("ix_settings_key", table_name="settings")
    op.drop_index("ix_settings_id", table_name="settings")
    op.drop_table("settings")

    op.drop_index("ix_logs_created_at", table_name="logs")
    op.drop_index("ix_logs_level", table_name="logs")
    op.drop_index("ix_logs_project_id", table_name="logs")
    op.drop_index("ix_logs_id", table_name="logs")
    op.drop_table("logs")

    op.drop_index("ix_projects_status", table_name="projects")
    op.drop_index("ix_projects_tech_stack", table_name="projects")
    op.drop_index("ix_projects_internal_port", table_name="projects")
    op.drop_index("ix_projects_domain", table_name="projects")
    op.drop_index("ix_projects_local_path", table_name="projects")
    op.drop_index("ix_projects_name", table_name="projects")
    op.drop_index("ix_projects_id", table_name="projects")
    op.drop_table("projects")
