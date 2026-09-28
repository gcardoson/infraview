import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class DeviceCategory(enum.StrEnum):
    firewall = "firewall"
    switch = "switch"
    access_point = "access_point"
    server = "server"
    telephony = "telephony"
    other = "other"


class LifecycleStatus(enum.StrEnum):
    active = "active"
    spare = "spare"
    maintenance = "maintenance"
    decommissioned = "decommissioned"


def _enum(cls: type[enum.Enum], name: str) -> Enum:
    return Enum(cls, name=name, values_callable=lambda e: [m.value for m in e])


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Site(TimestampMixin, Base):
    """A plant, office or datacenter where equipment is installed."""

    __tablename__ = "sites"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(64))
    country: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)

    devices: Mapped[list["Device"]] = relationship(back_populates="site")
    links: Mapped[list["InternetLink"]] = relationship(back_populates="site")


class Device(TimestampMixin, Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="RESTRICT"), index=True)
    category: Mapped[DeviceCategory] = mapped_column(_enum(DeviceCategory, "device_category"))
    hostname: Mapped[str] = mapped_column(String(255))
    management_ip: Mapped[str | None] = mapped_column(String(45))
    vendor: Mapped[str | None] = mapped_column(String(120))
    model: Mapped[str | None] = mapped_column(String(120))
    serial_number: Mapped[str | None] = mapped_column(String(120), unique=True)
    firmware_version: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[LifecycleStatus] = mapped_column(
        _enum(LifecycleStatus, "lifecycle_status"), default=LifecycleStatus.active
    )
    notes: Mapped[str | None] = mapped_column(Text)
    # Reserved for the upcoming LibreNMS / PRTG integration.
    librenms_device_id: Mapped[int | None] = mapped_column(Integer)
    prtg_object_id: Mapped[int | None] = mapped_column(Integer)

    site: Mapped[Site] = relationship(back_populates="devices")


class InternetLink(TimestampMixin, Base):
    __tablename__ = "internet_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="RESTRICT"), index=True)
    provider: Mapped[str] = mapped_column(String(120))
    circuit_id: Mapped[str | None] = mapped_column(String(120))
    technology: Mapped[str | None] = mapped_column(String(64))
    bandwidth_mbps: Mapped[int | None] = mapped_column(Integer)
    public_ip: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[LifecycleStatus] = mapped_column(
        _enum(LifecycleStatus, "lifecycle_status"), default=LifecycleStatus.active
    )
    notes: Mapped[str | None] = mapped_column(Text)
    librenms_device_id: Mapped[int | None] = mapped_column(Integer)
    prtg_object_id: Mapped[int | None] = mapped_column(Integer)

    site: Mapped[Site] = relationship(back_populates="links")
