# InfraView

Inventário e monitoramento da infraestrutura de TI: links de internet, firewalls, switches,
access points, servidores e telefonia.

## Estado atual

Primeira fase: **inventário**. A interface é organizada por camadas; a primeira pronta é a
**Layer 4 · Rede WAN**:

- inventário dos links de cada site: operadora, circuito, tecnologia, banda, papel
  (principal/secundário/backup), IP fixo, máscara, gateway, mascaramento (NAT), equipamento e
  porta SD-WAN e VLANs internas;
- topologia animada (operadoras → SD-WAN → core/LAN), painéis de tráfego, latência, alertas e
  disponibilidade, e um log de eventos.

Status, tráfego, alertas e log ainda são **simulados** no navegador, só para visualizar a tela em
funcionamento. Os campos `librenms_device_id` e `prtg_object_id` já existem para a próxima fase,
que vai puxar dados reais das APIs do LibreNMS e do PRTG.

## Stack

| Camada    | Tecnologia                                   |
|-----------|----------------------------------------------|
| Backend   | Python 3.12, FastAPI, SQLAlchemy 2, Alembic  |
| Banco     | PostgreSQL 16                                |
| Frontend  | React 19, TypeScript, Vite                   |
| Execução  | Docker Compose (frontend servido por nginx)  |

## Subindo com Docker

```bash
cp .env.example .env   # ajuste a senha do banco
docker compose up -d --build
```

- Interface web: http://localhost:8080
- API e documentação interativa: http://localhost:8010/docs

As portas publicadas podem ser trocadas no `.env` (`API_PORT` e `WEB_PORT`). A API usa 8010 para não conflitar com o Infra Docs, que já ocupa a 8000.

As migrações do banco rodam automaticamente quando o backend sobe. Para carregar dados de exemplo
(duas plantas fictícias com seus links), com o banco ainda vazio:

```bash
docker compose exec backend python -m app.seed
```

## Desenvolvimento local

Backend (precisa de um PostgreSQL acessível, por exemplo `docker compose up -d db` com a porta exposta):

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8010
```

Testes (usam o banco de `TEST_DATABASE_URL`, por padrão `infraview_test` em localhost):

```bash
ruff check . && ruff format --check .
pytest
```

Frontend (o Vite encaminha `/api` para `http://localhost:8010`):

```bash
cd frontend
npm install
npm run dev
```

## Estrutura

```
backend/
  app/models.py         modelos: Site, Device, InternetLink
  app/schemas.py        validação de entrada e saída (Pydantic)
  app/routers/          rotas CRUD em /api/sites, /api/devices, /api/links
  app/seed.py           dados de exemplo
  alembic/              migrações do banco
  tests/                testes da API
frontend/
  src/wan/              tela Layer 4 · Rede WAN (topologia, painéis, simulação, formulário)
  src/pages/            cadastro de sites
  src/components/       layout, relógio, modal
docker-compose.yml
```

## Próximos passos

1. Demais camadas: firewall, switches, Wi-Fi, servidores e telefonia.
2. Integração com LibreNMS e PRTG: trocar a telemetria simulada por dados reais.
3. Autenticação de usuários.
