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
    UniqueConstraint,
    false,
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


class RoomKind(enum.StrEnum):
    cpd = "cpd"
    rack = "rack"


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
    vlans: Mapped[list["Vlan"]] = relationship(back_populates="site")
    # A site's rooms, drawing and cluster go with it; links, devices and VLANs must be removed first.
    rooms: Mapped[list["Room"]] = relationship(back_populates="site", cascade="all, delete-orphan")
    topology: Mapped["Topology | None"] = relationship(back_populates="site", cascade="all, delete-orphan")
    cluster: Mapped["Cluster | None"] = relationship(back_populates="site", cascade="all, delete-orphan")


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


class Vlan(TimestampMixin, Base):
    """A VLAN of a site's internal network; the VLAN number is unique within the site."""

    __tablename__ = "vlans"
    __table_args__ = (UniqueConstraint("site_id", "vlan_id", name="uq_vlans_site_vlan"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="RESTRICT"), index=True)
    vlan_id: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(120))
    subnet: Mapped[str | None] = mapped_column(String(64))
    gateway_ip: Mapped[str | None] = mapped_column(String(45))
    dhcp: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    status: Mapped[LifecycleStatus] = mapped_column(
        _enum(LifecycleStatus, "lifecycle_status"), default=LifecycleStatus.active
    )
    notes: Mapped[str | None] = mapped_column(Text)

    site: Mapped[Site] = relationship(back_populates="vlans")


class Room(TimestampMixin, Base):
    """A CPD or an access rack of a site. Every site has at least one."""

    __tablename__ = "rooms"
    __table_args__ = (UniqueConstraint("site_id", "code", name="uq_rooms_site_code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    kind: Mapped[RoomKind] = mapped_column(_enum(RoomKind, "room_kind"))
    code: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(200))
    building: Mapped[str | None] = mapped_column(String(200))
    # The switch of the site's topology that lives here; its ports and links show on the room page.
    node_id: Mapped[str | None] = mapped_column(String(64))
    # Map position; when empty the room is placed from the topology drawing (or at the site).
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    cameras: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    cooling: Mapped[str | None] = mapped_column(String(200))
    access: Mapped[str | None] = mapped_column(String(120))
    power_capacity_kw: Mapped[float | None] = mapped_column(Float)
    # [{"name": "RK-01 · Rede", "heightU": 42}]; the first rack holds the network equipment.
    racks: Mapped[list[dict]] = mapped_column(JSON, default=list, server_default=text("'[]'"))
    notes: Mapped[str | None] = mapped_column(Text)

    site: Mapped[Site] = relationship(back_populates="rooms")


class Topology(TimestampMixin, Base):
    """A site's Layer 2 drawing: header fields plus the nodes, links and annotations as a document."""

    __tablename__ = "topologies"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    city: Mapped[str | None] = mapped_column(String(120))
    revision: Mapped[str | None] = mapped_column(String(32))
    date: Mapped[str | None] = mapped_column(String(32))
    author: Mapped[str | None] = mapped_column(String(120))
    document: Mapped[dict] = mapped_column(JSON)

    site: Mapped[Site] = relationship(back_populates="topology")


class Cluster(TimestampMixin, Base):
    """A site's virtualization cluster: hosts, datastores and storage array as a document."""

    __tablename__ = "clusters"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    vcenter: Mapped[str | None] = mapped_column(String(200))
    ha_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    drs: Mapped[str | None] = mapped_column(String(32))
    document: Mapped[dict] = mapped_column(JSON)

    site: Mapped[Site] = relationship(back_populates="cluster")
