from datetime import datetime
from ipaddress import IPv4Address, IPv4Network, IPv6Address, IPv6Network

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.models import DeviceCategory, LifecycleStatus, LinkRole, RoomKind


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class SiteBase(BaseModel):
    code: str = Field(max_length=32)
    name: str = Field(max_length=200)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=64)
    country: str | None = Field(default=None, max_length=64)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    notes: str | None = None


class RackSpec(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    heightU: int = Field(ge=1, le=60)  # noqa: N815 (shared camelCase document with the frontend)


class RoomFields(BaseModel):
    kind: RoomKind
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    building: str | None = Field(default=None, max_length=200)
    node_id: str | None = Field(default=None, max_length=64)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    cameras: int = Field(default=0, ge=0, le=64)
    cooling: str | None = Field(default=None, max_length=200)
    access: str | None = Field(default=None, max_length=120)
    power_capacity_kw: float | None = Field(default=None, ge=0)
    racks: list[RackSpec] = Field(min_length=1)
    notes: str | None = None


class SiteCreate(SiteBase):
    # A new site starts with at least one CPD or rack.
    rooms: list[RoomFields] = Field(min_length=1)


class SiteUpdate(BaseModel):
    code: str | None = Field(default=None, max_length=32)
    name: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=64)
    country: str | None = Field(default=None, max_length=64)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    notes: str | None = None


class SiteRead(SiteBase, ORMModel):
    id: int
    created_at: datetime
    updated_at: datetime


class DeviceBase(BaseModel):
    site_id: int
    category: DeviceCategory
    hostname: str = Field(max_length=255)
    management_ip: IPv4Address | IPv6Address | None = None
    vendor: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    serial_number: str | None = Field(default=None, max_length=120)
    firmware_version: str | None = Field(default=None, max_length=120)
    status: LifecycleStatus = LifecycleStatus.active
    notes: str | None = None
    librenms_device_id: int | None = None
    prtg_object_id: int | None = None

    @field_serializer("management_ip")
    def _ip_to_str(self, value: IPv4Address | IPv6Address | None) -> str | None:
        return str(value) if value is not None else None


class DeviceCreate(DeviceBase):
    pass


class DeviceUpdate(BaseModel):
    site_id: int | None = None
    category: DeviceCategory | None = None
    hostname: str | None = Field(default=None, max_length=255)
    management_ip: IPv4Address | IPv6Address | None = None
    vendor: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    serial_number: str | None = Field(default=None, max_length=120)
    firmware_version: str | None = Field(default=None, max_length=120)
    status: LifecycleStatus | None = None
    notes: str | None = None
    librenms_device_id: int | None = None
    prtg_object_id: int | None = None

    @field_serializer("management_ip")
    def _ip_to_str(self, value: IPv4Address | IPv6Address | None) -> str | None:
        return str(value) if value is not None else None


class DeviceRead(DeviceBase, ORMModel):
    id: int
    created_at: datetime
    updated_at: datetime


class Vlan(BaseModel):
    vlan_id: int = Field(ge=1, le=4094)
    name: str | None = Field(default=None, max_length=120)
    subnet: IPv4Network | IPv6Network | None = None

    @field_serializer("subnet")
    def _subnet_to_str(self, value: IPv4Network | IPv6Network | None) -> str | None:
        return str(value) if value is not None else None


class InternetLinkBase(BaseModel):
    site_id: int
    provider: str = Field(max_length=120)
    circuit_id: str | None = Field(default=None, max_length=120)
    technology: str | None = Field(default=None, max_length=64)
    bandwidth_mbps: int | None = Field(default=None, ge=0)
    role: LinkRole = LinkRole.primary
    public_ip: str | None = Field(default=None, max_length=64)
    netmask: str | None = Field(default=None, max_length=64)
    gateway_ip: IPv4Address | IPv6Address | None = None
    nat_enabled: bool = True
    sdwan_device: str | None = Field(default=None, max_length=120)
    sdwan_port: str | None = Field(default=None, max_length=64)
    vlans: list[Vlan] = Field(default_factory=list)
    status: LifecycleStatus = LifecycleStatus.active
    notes: str | None = None
    librenms_device_id: int | None = None
    prtg_object_id: int | None = None

    @field_serializer("gateway_ip")
    def _ip_to_str(self, value: IPv4Address | IPv6Address | None) -> str | None:
        return str(value) if value is not None else None


class InternetLinkCreate(InternetLinkBase):
    pass


class InternetLinkUpdate(BaseModel):
    site_id: int | None = None
    provider: str | None = Field(default=None, max_length=120)
    circuit_id: str | None = Field(default=None, max_length=120)
    technology: str | None = Field(default=None, max_length=64)
    bandwidth_mbps: int | None = Field(default=None, ge=0)
    role: LinkRole | None = None
    public_ip: str | None = Field(default=None, max_length=64)
    netmask: str | None = Field(default=None, max_length=64)
    gateway_ip: IPv4Address | IPv6Address | None = None
    nat_enabled: bool | None = None
    sdwan_device: str | None = Field(default=None, max_length=120)
    sdwan_port: str | None = Field(default=None, max_length=64)
    vlans: list[Vlan] | None = None
    status: LifecycleStatus | None = None
    notes: str | None = None
    librenms_device_id: int | None = None
    prtg_object_id: int | None = None

    @field_serializer("gateway_ip")
    def _ip_to_str(self, value: IPv4Address | IPv6Address | None) -> str | None:
        return str(value) if value is not None else None


class InternetLinkRead(InternetLinkBase, ORMModel):
    id: int
    created_at: datetime
    updated_at: datetime


class VlanBase(BaseModel):
    site_id: int
    vlan_id: int = Field(ge=1, le=4094)
    name: str = Field(min_length=1, max_length=120)
    subnet: IPv4Network | IPv6Network | None = None
    gateway_ip: IPv4Address | IPv6Address | None = None
    dhcp: bool = False
    status: LifecycleStatus = LifecycleStatus.active
    notes: str | None = None

    @field_serializer("subnet", "gateway_ip")
    def _to_str(self, value: object) -> str | None:
        return str(value) if value is not None else None


class VlanCreate(VlanBase):
    pass


class VlanUpdate(BaseModel):
    site_id: int | None = None
    vlan_id: int | None = Field(default=None, ge=1, le=4094)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    subnet: IPv4Network | IPv6Network | None = None
    gateway_ip: IPv4Address | IPv6Address | None = None
    dhcp: bool | None = None
    status: LifecycleStatus | None = None
    notes: str | None = None

    @field_serializer("subnet", "gateway_ip")
    def _to_str(self, value: object) -> str | None:
        return str(value) if value is not None else None


class VlanRead(VlanBase, ORMModel):
    id: int
    created_at: datetime
    updated_at: datetime


class RoomCreate(RoomFields):
    site_id: int


class RoomUpdate(BaseModel):
    kind: RoomKind | None = None
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    building: str | None = Field(default=None, max_length=200)
    node_id: str | None = Field(default=None, max_length=64)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    cameras: int | None = Field(default=None, ge=0, le=64)
    cooling: str | None = Field(default=None, max_length=200)
    access: str | None = Field(default=None, max_length=120)
    power_capacity_kw: float | None = Field(default=None, ge=0)
    racks: list[RackSpec] | None = Field(default=None, min_length=1)
    notes: str | None = None


class RoomRead(RoomCreate, ORMModel):
    id: int
    created_at: datetime
    updated_at: datetime


class TopologyDocument(BaseModel):
    """The drawing itself; nodes and links keep the shape the frontend draws (see topology/data.ts)."""

    model_config = ConfigDict(extra="allow")

    view: list[float] = Field(min_length=4, max_length=4)
    nodes: list[dict]
    links: list[dict]
    annotations: list[dict] = Field(default_factory=list)


class TopologyBase(BaseModel):
    site_id: int
    name: str = Field(min_length=1, max_length=200)
    city: str | None = Field(default=None, max_length=120)
    revision: str | None = Field(default=None, max_length=32)
    date: str | None = Field(default=None, max_length=32)
    author: str | None = Field(default=None, max_length=120)
    document: TopologyDocument


class TopologyCreate(TopologyBase):
    pass


class TopologyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    city: str | None = Field(default=None, max_length=120)
    revision: str | None = Field(default=None, max_length=32)
    date: str | None = Field(default=None, max_length=32)
    author: str | None = Field(default=None, max_length=120)
    document: TopologyDocument | None = None


class TopologyRead(TopologyBase, ORMModel):
    id: int
    created_at: datetime
    updated_at: datetime


class ClusterDocument(BaseModel):
    """Hosts, datastores and the storage array, in the shape the frontend uses (see servers/data.ts)."""

    model_config = ConfigDict(extra="allow")

    hosts: list[dict]
    datastores: list[dict] = Field(default_factory=list)
    array: dict | None = None


class ClusterBase(BaseModel):
    site_id: int
    name: str = Field(min_length=1, max_length=120)
    vcenter: str | None = Field(default=None, max_length=200)
    ha_enabled: bool = True
    drs: str | None = Field(default=None, max_length=32)
    document: ClusterDocument


class ClusterCreate(ClusterBase):
    pass


class ClusterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    vcenter: str | None = Field(default=None, max_length=200)
    ha_enabled: bool | None = None
    drs: str | None = Field(default=None, max_length=32)
    document: ClusterDocument | None = None


class ClusterRead(ClusterBase, ORMModel):
    id: int
    created_at: datetime
    updated_at: datetime
