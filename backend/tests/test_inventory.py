from fastapi.testclient import TestClient

CPD = {"kind": "cpd", "code": "CPD", "name": "CPD", "racks": [{"name": "RK-01", "heightU": 42}]}


def make_site(client: TestClient, code: str = "BH01") -> dict:
    response = client.post("/api/sites", json={"code": code, "name": f"Planta {code}", "rooms": [CPD]})
    assert response.status_code == 201, response.text
    return response.json()


def test_health(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_site_crud(client: TestClient) -> None:
    site = make_site(client)
    assert client.get(f"/api/sites/{site['id']}").json()["code"] == "BH01"

    updated = client.patch(f"/api/sites/{site['id']}", json={"city": "Belo Horizonte"}).json()
    assert updated["city"] == "Belo Horizonte"
    assert updated["name"] == "Planta BH01"

    assert client.delete(f"/api/sites/{site['id']}").status_code == 204
    assert client.get(f"/api/sites/{site['id']}").status_code == 404


def test_duplicate_site_code_conflicts(client: TestClient) -> None:
    make_site(client)
    response = client.post("/api/sites", json={"code": "BH01", "name": "Outra", "rooms": [CPD]})
    assert response.status_code == 409


def test_device_filters_and_ip_validation(client: TestClient) -> None:
    site = make_site(client)
    other = make_site(client, "SP01")
    for site_id, category, hostname in [
        (site["id"], "switch", "sw-bh01-core"),
        (site["id"], "firewall", "fw-bh01"),
        (other["id"], "switch", "sw-sp01-core"),
    ]:
        payload = {
            "site_id": site_id,
            "category": category,
            "hostname": hostname,
            "management_ip": "10.0.0.1",
        }
        response = client.post("/api/devices", json=payload)
        assert response.status_code == 201, response.text

    switches = client.get("/api/devices", params={"category": "switch"}).json()
    assert [d["hostname"] for d in switches] == ["sw-bh01-core", "sw-sp01-core"]

    at_site = client.get("/api/devices", params={"site_id": site["id"]}).json()
    assert {d["hostname"] for d in at_site} == {"fw-bh01", "sw-bh01-core"}
    assert at_site[0]["management_ip"] == "10.0.0.1"

    bad_ip = client.post(
        "/api/devices",
        json={"site_id": site["id"], "category": "server", "hostname": "srv", "management_ip": "999.1.1.1"},
    )
    assert bad_ip.status_code == 422


def test_site_in_use_cannot_be_deleted(client: TestClient) -> None:
    site = make_site(client)
    client.post("/api/links", json={"site_id": site["id"], "provider": "Vivo", "bandwidth_mbps": 200})
    assert client.delete(f"/api/sites/{site['id']}").status_code == 409


def test_link_wan_details(client: TestClient) -> None:
    site = make_site(client)
    payload = {
        "site_id": site["id"],
        "provider": "Vivo",
        "role": "secondary",
        "public_ip": "200.160.12.40/29",
        "netmask": "255.255.255.248",
        "gateway_ip": "200.160.12.41",
        "nat_enabled": False,
        "sdwan_device": "FGT-01",
        "sdwan_port": "wan2",
        "vlans": [{"vlan_id": 10, "name": "Corp", "subnet": "10.0.10.0/24"}],
    }
    link = client.post("/api/links", json=payload).json()
    assert link["role"] == "secondary"
    assert link["gateway_ip"] == "200.160.12.41"
    assert link["nat_enabled"] is False
    assert link["vlans"] == [{"vlan_id": 10, "name": "Corp", "subnet": "10.0.10.0/24"}]

    patched = client.patch(f"/api/links/{link['id']}", json={"vlans": []}).json()
    assert patched["vlans"] == []

    bad_vlan = client.post("/api/links", json={**payload, "vlans": [{"vlan_id": 5000}]})
    assert bad_vlan.status_code == 422


def test_link_defaults(client: TestClient) -> None:
    site = make_site(client)
    link = client.post("/api/links", json={"site_id": site["id"], "provider": "TIM"}).json()
    assert link["role"] == "primary"
    assert link["nat_enabled"] is True
    assert link["vlans"] == []


def test_site_coordinates_are_validated(client: TestClient) -> None:
    site = make_site(client)
    updated = client.patch(f"/api/sites/{site['id']}", json={"latitude": -20.28, "longitude": -45.54})
    assert updated.status_code == 200, updated.text
    assert (updated.json()["latitude"], updated.json()["longitude"]) == (-20.28, -45.54)

    response = client.patch(f"/api/sites/{site['id']}", json={"latitude": 95})
    assert response.status_code == 422


def test_vlan_crud_and_unique_per_site(client: TestClient) -> None:
    site = make_site(client)
    other = make_site(client, "SP01")
    payload = {"site_id": site["id"], "vlan_id": 10, "name": "Corporativa", "subnet": "10.20.10.0/24"}
    created = client.post("/api/vlans", json={**payload, "gateway_ip": "10.20.10.1", "dhcp": True})
    assert created.status_code == 201, created.text
    vlan = created.json()
    assert vlan["subnet"] == "10.20.10.0/24"
    assert vlan["gateway_ip"] == "10.20.10.1"

    # Same number on the same site conflicts; on another site it is fine.
    assert client.post("/api/vlans", json=payload).status_code == 409
    assert client.post("/api/vlans", json={**payload, "site_id": other["id"]}).status_code == 201
    assert client.post("/api/vlans", json={**payload, "vlan_id": 4095}).status_code == 422
    bad_subnet = {**payload, "vlan_id": 20, "subnet": "10.20.10.1/24"}
    assert client.post("/api/vlans", json=bad_subnet).status_code == 422

    listed = client.get("/api/vlans", params={"site_id": site["id"]}).json()
    assert [v["vlan_id"] for v in listed] == [10]

    updated = client.patch(f"/api/vlans/{vlan['id']}", json={"name": "Escritório"}).json()
    assert updated["name"] == "Escritório"
    assert client.delete(f"/api/vlans/{vlan['id']}").status_code == 204


def test_site_needs_a_room_and_keeps_the_last_one(client: TestClient) -> None:
    no_room = {"code": "BH01", "name": "Sem sala", "rooms": []}
    assert client.post("/api/sites", json=no_room).status_code == 422
    site = make_site(client)
    rooms = client.get("/api/rooms", params={"site_id": site["id"]}).json()
    assert [r["code"] for r in rooms] == ["CPD"]

    rack = {"site_id": site["id"], "kind": "rack", "code": "RK-ADM", "name": "Rack ADM"}
    assert client.post("/api/rooms", json={**rack, "racks": []}).status_code == 422
    created = client.post("/api/rooms", json={**rack, "racks": [{"name": "RK-ADM", "heightU": 12}]})
    assert created.status_code == 201, created.text
    duplicate = {**rack, "racks": [{"name": "x", "heightU": 12}]}
    assert client.post("/api/rooms", json=duplicate).status_code == 409

    assert client.delete(f"/api/rooms/{rooms[0]['id']}").status_code == 204
    # The rack is now the only room left, so it stays.
    assert client.delete(f"/api/rooms/{created.json()['id']}").status_code == 409


def test_topology_and_cluster_one_per_site(client: TestClient) -> None:
    site = make_site(client)
    topology = {
        "site_id": site["id"],
        "name": "Planta BH01",
        "document": {"view": [0, 0, 800, 600], "nodes": [{"id": "SW1", "kind": "core"}], "links": []},
    }
    created = client.post("/api/topologies", json=topology)
    assert created.status_code == 201, created.text
    assert created.json()["document"]["nodes"][0]["id"] == "SW1"
    assert client.post("/api/topologies", json=topology).status_code == 409
    assert client.post("/api/topologies", json={**topology, "document": {"nodes": []}}).status_code == 422

    cluster = {"site_id": site["id"], "name": "CL-BH01", "document": {"hosts": [{"name": "esx01"}]}}
    created = client.post("/api/clusters", json=cluster)
    assert created.status_code == 201, created.text
    patched = client.patch(f"/api/clusters/{created.json()['id']}", json={"drs": "Manual"}).json()
    assert patched["drs"] == "Manual"
    assert patched["document"]["hosts"][0]["name"] == "esx01"
    assert client.post("/api/clusters", json=cluster).status_code == 409
