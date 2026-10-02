"""Load fictitious sample data so the interface has something to show.

Usage: python -m app.seed   (if sites already exist, only fills missing coordinates of the sample sites)
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.initial_data import DEFAULT_ROOM, initial_for
from app.models import Cluster, InternetLink, LinkRole, Room, Site, Topology, Vlan

SAMPLE = [
    {
        "site": {
            "code": "BR-ARC",
            "name": "Planta Arcos",
            "city": "Arcos",
            "state": "MG",
            "country": "Brasil",
            "latitude": -20.2863,
            "longitude": -45.5402,
        },
        "links": [
            {
                "provider": "Vivo Empresas",
                "circuit_id": "VIV-ARC-004512",
                "technology": "Fibra dedicada",
                "bandwidth_mbps": 500,
                "role": LinkRole.primary,
                "public_ip": "200.160.12.40/29",
                "netmask": "255.255.255.248",
                "gateway_ip": "200.160.12.41",
                "nat_enabled": True,
                "sdwan_device": "FGT-ARC-01",
                "sdwan_port": "wan1",
                "vlans": [
                    {"vlan_id": 10, "name": "Corporativa", "subnet": "10.20.10.0/24"},
                    {"vlan_id": 20, "name": "Automação", "subnet": "10.20.20.0/24"},
                    {"vlan_id": 30, "name": "Voz", "subnet": "10.20.30.0/24"},
                ],
            },
            {
                "provider": "Claro Embratel",
                "circuit_id": "EMB-778120-ARC",
                "technology": "MPLS",
                "bandwidth_mbps": 200,
                "role": LinkRole.secondary,
                "public_ip": "187.45.200.18",
                "netmask": "255.255.255.252",
                "gateway_ip": "187.45.200.17",
                "nat_enabled": True,
                "sdwan_device": "FGT-ARC-01",
                "sdwan_port": "wan2",
                "vlans": [{"vlan_id": 10, "name": "Corporativa", "subnet": "10.20.10.0/24"}],
            },
            {
                "provider": "Starlink Business",
                "circuit_id": "SL-ARC-01",
                "technology": "Satélite LEO",
                "bandwidth_mbps": 220,
                "role": LinkRole.backup,
                "nat_enabled": True,
                "sdwan_device": "FGT-ARC-01",
                "sdwan_port": "port5",
                "vlans": [{"vlan_id": 30, "name": "Voz", "subnet": "10.20.30.0/24"}],
            },
        ],
    },
    {
        "site": {
            "code": "BR-MAT",
            "name": "Planta Matozinhos",
            "city": "Matozinhos",
            "state": "MG",
            "latitude": -19.5543,
            "longitude": -44.0868,
        },
        "links": [
            {
                "provider": "Algar Telecom",
                "circuit_id": "ALG-99812",
                "technology": "Fibra dedicada",
                "bandwidth_mbps": 300,
                "role": LinkRole.primary,
                "public_ip": "177.66.3.10/30",
                "netmask": "255.255.255.252",
                "gateway_ip": "177.66.3.9",
                "sdwan_device": "FGT-MAT-01",
                "sdwan_port": "wan1",
                "vlans": [
                    {"vlan_id": 10, "name": "Corporativa", "subnet": "10.30.10.0/24"},
                    {"vlan_id": 40, "name": "CFTV", "subnet": "10.30.40.0/24"},
                ],
            },
            {
                "provider": "TIM Live",
                "circuit_id": "TIM-MAT-7781",
                "technology": "4G/LTE",
                "bandwidth_mbps": 50,
                "role": LinkRole.backup,
                "sdwan_device": "FGT-MAT-01",
                "sdwan_port": "wan2",
            },
        ],
    },
]


def fill_coordinates(session: Session) -> None:
    """Give the sample sites a map position when they were created before sites had coordinates."""
    filled = 0
    for entry in SAMPLE:
        data = entry["site"]
        site = session.scalar(select(Site).where(Site.code == data["code"]))
        if site is not None and site.latitude is None and site.longitude is None:
            site.latitude, site.longitude = data["latitude"], data["longitude"]
            filled += 1
    session.commit()
    if filled:
        print(f"Coordenadas preenchidas em {filled} sites de exemplo.")
    else:
        print("Já existem sites cadastrados; nada foi alterado.")


def main() -> None:
    with SessionLocal() as session:
        if session.scalar(select(Site.id).limit(1)) is not None:
            fill_coordinates(session)
            return
        for entry in SAMPLE:
            site = Site(**entry["site"])
            site.links = [InternetLink(**link) for link in entry["links"]]
            # The site's VLAN register starts with every VLAN its links carry.
            vlans = {v["vlan_id"]: v for link in entry["links"] for v in link.get("vlans", [])}
            site.vlans = [Vlan(**v) for _, v in sorted(vlans.items())]
            initial = initial_for(site.code)
            site.rooms = [Room(**room) for room in (initial["rooms"] if initial else [DEFAULT_ROOM])]
            if initial and initial["topology"]:
                site.topology = Topology(**initial["topology"])
            if initial and initial["cluster"]:
                site.cluster = Cluster(**initial["cluster"])
            session.add(site)
        session.commit()
        print(f"Dados de exemplo criados: {len(SAMPLE)} sites.")


if __name__ == "__main__":
    main()
