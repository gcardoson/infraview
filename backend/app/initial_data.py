"""What the screens showed before they became editable: rooms, topology and cluster of the sample sites.

Topologies were transcribed from the plants' Visio drawings; rooms follow from them (the central switch in
the CPD, every other switch in an access rack); the clusters are fictitious. Migration 0005 copies them
into existing databases and the seed into fresh ones.
"""

import json
from functools import cache
from pathlib import Path

DEFAULT_ROOM = {
    "kind": "cpd",
    "code": "CPD",
    "name": "CPD",
    "cameras": 0,
    "racks": [{"name": "RK-01 · Rede", "heightU": 42}],
}


@cache
def _inventory() -> dict:
    return json.loads((Path(__file__).parent / "data" / "initial_inventory.json").read_text(encoding="utf-8"))


def initial_for(site_code: str) -> dict | None:
    """{"rooms": [...], "topology": {...} | None, "cluster": {...}} for a sample site, else None."""
    return _inventory().get(site_code)
