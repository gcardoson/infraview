from datetime import datetime
from ipaddress import IPv4Address, IPv6Address

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.models import DeviceCategory, LifecycleStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class SiteBase(BaseModel):
    code: str = Field(max_length=32)
    name: str = Field(max_length=200)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=64)
    country: str | None = Field(default=None, max_length=64)
    notes: str | None = None


class SiteCreate(SiteBase):
    pass


class SiteUpdate(BaseModel):
    code: str | None = Field(default=None, max_length=32)
    name: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=64)
    country: str | None = Field(default=None, max_length=64)
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


class InternetLinkBase(BaseModel):
    site_id: int
    provider: str = Field(max_length=120)
    circuit_id: str | None = Field(default=None, max_length=120)
    technology: str | None = Field(default=None, max_length=64)
    bandwidth_mbps: int | None = Field(default=None, ge=0)
    public_ip: str | None = Field(default=None, max_length=64)
    status: LifecycleStatus = LifecycleStatus.active
    notes: str | None = None
    librenms_device_id: int | None = None
    prtg_object_id: int | None = None


class InternetLinkCreate(InternetLinkBase):
    pass


class InternetLinkUpdate(BaseModel):
    site_id: int | None = None
    provider: str | None = Field(default=None, max_length=120)
    circuit_id: str | None = Field(default=None, max_length=120)
    technology: str | None = Field(default=None, max_length=64)
    bandwidth_mbps: int | None = Field(default=None, ge=0)
    public_ip: str | None = Field(default=None, max_length=64)
    status: LifecycleStatus | None = None
    notes: str | None = None
    librenms_device_id: int | None = None
    prtg_object_id: int | None = None


class InternetLinkRead(InternetLinkBase, ORMModel):
    id: int
    created_at: datetime
    updated_at: datetime
