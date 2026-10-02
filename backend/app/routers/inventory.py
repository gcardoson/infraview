from app import models, schemas
from app.routers.crud import crud_router

sites = crud_router(
    model=models.Site,
    create_schema=schemas.SiteCreate,
    update_schema=schemas.SiteUpdate,
    read_schema=schemas.SiteRead,
    order_by="code",
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
