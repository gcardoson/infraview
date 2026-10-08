from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models, schemas
from app.routers.crud import crud_router


def _site_with_rooms(data: dict) -> models.Site:
    rooms = data.pop("rooms")
    return models.Site(**data, rooms=[models.Room(**room) for room in rooms])


def _keep_one_room(session: Session, room: models.Room) -> None:
    count = session.scalar(select(func.count()).where(models.Room.site_id == room.site_id))
    if count is not None and count <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "Every site needs at least one CPD or rack")


sites = crud_router(
    model=models.Site,
    create_schema=schemas.SiteCreate,
    update_schema=schemas.SiteUpdate,
    read_schema=schemas.SiteRead,
    order_by="code",
    build=_site_with_rooms,
)

devices = crud_router(
    model=models.Device,
    create_schema=schemas.DeviceCreate,
    update_schema=schemas.DeviceUpdate,
    read_schema=schemas.DeviceRead,
    filters=("site_id", "category"),
    order_by="hostname",
)

links = crud_router(
    model=models.InternetLink,
    create_schema=schemas.InternetLinkCreate,
    update_schema=schemas.InternetLinkUpdate,
    read_schema=schemas.InternetLinkRead,
    filters=("site_id",),
    order_by="provider",
)

vlans = crud_router(
    model=models.Vlan,
    create_schema=schemas.VlanCreate,
    update_schema=schemas.VlanUpdate,
    read_schema=schemas.VlanRead,
    filters=("site_id",),
    order_by="vlan_id",
)

rooms = crud_router(
    model=models.Room,
    create_schema=schemas.RoomCreate,
    update_schema=schemas.RoomUpdate,
    read_schema=schemas.RoomRead,
    filters=("site_id",),
    order_by="code",
    before_delete=_keep_one_room,
)

topologies = crud_router(
    model=models.Topology,
    create_schema=schemas.TopologyCreate,
    update_schema=schemas.TopologyUpdate,
    read_schema=schemas.TopologyRead,
    filters=("site_id",),
    order_by="site_id",
)

clusters = crud_router(
    model=models.Cluster,
    create_schema=schemas.ClusterCreate,
    update_schema=schemas.ClusterUpdate,
    read_schema=schemas.ClusterRead,
    filters=("site_id",),
    order_by="site_id",
)
