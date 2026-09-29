import enum
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class DeviceCategory(enum.StrEnum):
    firewall = "firewall"
    switch = "switch"
    access_point = "access_point"
    server = "server"
    telephony = "telephony"
    other = "other"


class LinkRole(enum.StrEnum):
    primary = "primary"
    secondary = "secondary"
    backup = "backup"


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
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
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
    role: Mapped[LinkRole] = mapped_column(
        _enum(LinkRole, "link_role"), default=LinkRole.primary, server_default=LinkRole.primary.value
    )
    # Fixed public addressing, when the provider delivers one.
    public_ip: Mapped[str | None] = mapped_column(String(64))
    netmask: Mapped[str | None] = mapped_column(String(64))
    gateway_ip: Mapped[str | None] = mapped_column(String(45))
    # Whether outbound traffic is masqueraded (source NAT) behind this link.
    nat_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    sdwan_device: Mapped[str | None] = mapped_column(String(120))
    sdwan_port: Mapped[str | None] = mapped_column(String(64))
    # Internal VLANs carried/served by this link: [{"vlan_id": 10, "name": "...", "subnet": "..."}].
    vlans: Mapped[list[dict]] = mapped_column(JSON, default=list, server_default=text("'[]'"))
    status: Mapped[LifecycleStatus] = mapped_column(
        _enum(LifecycleStatus, "lifecycle_status"), default=LifecycleStatus.active
    )
    notes: Mapped[str | None] = mapped_column(Text)
    librenms_device_id: Mapped[int | None] = mapped_column(Integer)
    prtg_object_id: Mapped[int | None] = mapped_column(Integer)

    site: Mapped[Site] = relationship(back_populates="links")
