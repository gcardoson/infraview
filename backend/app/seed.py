"""Load fictitious sample data so the interface has something to show.

Usage: python -m app.seed   (does nothing if any site already exists)
"""

from sqlalchemy import select

from app.db import SessionLocal
from app.models import InternetLink, LinkRole, Site

SAMPLE = [
    {
        "site": {
            "code": "BR-ARC",
            "name": "Planta Arcos",
            "city": "Arcos",
            "state": "MG",
            "country": "Brasil",
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
        "site": {"code": "BR-MAT", "name": "Planta Matozinhos", "city": "Matozinhos", "state": "MG"},
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


def main() -> None:
    with SessionLocal() as session:
        if session.scalar(select(Site.id).limit(1)) is not None:
            print("Já existem sites cadastrados; nada foi alterado.")
            return
        for entry in SAMPLE:
            site = Site(**entry["site"])
            site.links = [InternetLink(**link) for link in entry["links"]]
            session.add(site)
        session.commit()
        print(f"Dados de exemplo criados: {len(SAMPLE)} sites.")


if __name__ == "__main__":
    main()
