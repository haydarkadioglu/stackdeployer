"""add preview deployment fields

Revision ID: 20260407_0005
Revises: 20260407_0004
Create Date: 2026-04-07 01:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260407_0005"
down_revision: Union[str, None] = "20260407_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "deployments",
        sa.Column("deployment_type", sa.String(length=16), nullable=False, server_default="production"),
    )
    op.add_column(
        "deployments",
        sa.Column("preview_port", sa.Integer(), nullable=True),
    )
    op.create_index("ix_deployments_deployment_type", "deployments", ["deployment_type"])
    op.create_index("ix_deployments_preview_port", "deployments", ["preview_port"])


def downgrade() -> None:
    op.drop_index("ix_deployments_preview_port", table_name="deployments")
    op.drop_index("ix_deployments_deployment_type", table_name="deployments")
    op.drop_column("deployments", "preview_port")
    op.drop_column("deployments", "deployment_type")
