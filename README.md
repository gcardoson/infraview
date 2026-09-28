# InfraView

Inventário e monitoramento da infraestrutura de TI: links de internet, firewalls, switches,
access points, servidores e telefonia.

## Estado atual

Primeira fase: **inventário**. É possível cadastrar sites (plantas/escritórios), equipamentos e
links de internet pela API e por uma interface web simples. Os campos `librenms_device_id` e
`prtg_object_id` já existem para a próxima fase, que vai puxar dados das APIs do LibreNMS e do PRTG.

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
- API e documentação interativa: http://localhost:8000/docs

As migrações do banco rodam automaticamente quando o backend sobe.

## Desenvolvimento local

Backend (precisa de um PostgreSQL acessível, por exemplo `docker compose up -d db` com a porta exposta):

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload
```

Testes (usam o banco de `TEST_DATABASE_URL`, por padrão `infraview_test` em localhost):

```bash
ruff check . && ruff format --check .
pytest
```

Frontend (o Vite encaminha `/api` para `http://localhost:8000`):

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
  alembic/              migrações do banco
  tests/                testes da API
frontend/
  src/App.tsx           abas de Sites, Equipamentos e Links
  src/ResourcePage.tsx  tabela e formulário genéricos
docker-compose.yml
```

## Próximos passos

1. Melhorar os cadastros: edição, busca, seleção do site por nome, importação por CSV.
2. Integração com LibreNMS e PRTG: sincronizar inventário e status dos equipamentos.
3. Autenticação de usuários.
