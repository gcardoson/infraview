# InfraView

Inventário e monitoramento da infraestrutura de TI: links de internet, firewalls, switches,
access points, servidores e telefonia.

## Estado atual

Primeira fase: **inventário**. A interface é organizada por camadas. Prontas até agora:

**Layer 4 · Rede WAN**:

- inventário dos links de cada site: operadora, circuito, tecnologia, banda, papel
  (principal/secundário/backup), IP fixo, máscara, gateway, mascaramento (NAT), equipamento e
  porta SD-WAN e VLANs internas;
- topologia animada (operadoras → SD-WAN → core/LAN), painéis de tráfego, latência, alertas e
  disponibilidade, e um log de eventos.

**Layer 3 · Switches** (`/lan`), com dados fictícios por enquanto:

- switches agrupados por site (grupos recolhíveis), um quadrado por porta, sempre em linhas de
  24 portas: switches de 48 portas ocupam duas linhas; os uplinks ficam nas colunas U1–U4;
- cores: verde conectada, amarela em alerta ou 100 Mbps, vermelha desconectada, com erro ou
  10 Mbps, cinza desabilitada;
- indicadores de saúde, filtro "somente com problemas", detalhes da porta e do switch ao clicar,
  alertas e log de eventos.

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

## Painel de controle no Windows

Para quem roda o servidor no próprio Windows (Docker dentro do Ubuntu/WSL), há um painel que
dispensa os comandos do Docker: dê dois cliques em `tools\InfraView.bat`. Na primeira vez ele
cria o atalho **InfraView** na área de trabalho.

O painel abre sem janela de console e mostra se o servidor está rodando, com os botões
**Iniciar**, **Parar**, **Reiniciar**, **Atualizar agora** e **Abrir no navegador**. Fechar a janela
só a esconde: o painel continua na bandeja do sistema, com um ícone que muda de cor conforme o
estado (verde rodando, amarelo trabalhando, cinza parado, vermelho com problema). O menu do botão
direito tem Abrir painel, Abrir no navegador, Iniciar, Parar, Reiniciar, Atualizar e **Desligar**,
que para o servidor e fecha o painel. Reiniciar e Desligar pedem confirmação. Com "Atualizar automaticamente" ligado, ele verifica o
GitHub a cada minuto e, se houver versão nova, baixa o código e reconstrói o servidor sozinho.
Por padrão ele segue a versão mais recente publicada (qualquer branch); dá para fixar uma branch
na lista "Versão do código".

Alterações locais nos arquivos do projeto são descartadas na atualização, e o `.env` é mantido.
A lógica fica em `tools/infraview.sh`, que também pode ser usado direto no Ubuntu:
`bash tools/infraview.sh status|start|stop|restart|update`.

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
  src/lan/              tela Layer 3 · Switches (grade de portas e dados fictícios)
  src/pages/            cadastro de sites
  src/components/       layout, relógio, modal
docker-compose.yml
```

## Próximos passos

1. Cadastro real de switches e portas, alimentado pelo LibreNMS.
2. Demais camadas: firewall, Wi-Fi, servidores e telefonia.
3. Integração com LibreNMS e PRTG: trocar a telemetria simulada por dados reais.
4. Autenticação de usuários.
