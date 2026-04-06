"""add service_type and make internal_port optional

Revision ID: 20260406_0002
Revises: 20260406_0001
Create Date: 2026-04-06 00:30:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260406_0002"
down_revision: Union[str, None] = "20260406_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(sa.Column("service_type", sa.String(length=16), nullable=False, server_default="web"))
        batch_op.alter_column("internal_port", existing_type=sa.Integer(), nullable=True)
        batch_op.create_index("ix_projects_service_type", ["service_type"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_index("ix_projects_service_type")
        batch_op.alter_column("internal_port", existing_type=sa.Integer(), nullable=False)
        batch_op.drop_column("service_type")
