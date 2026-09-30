# InfraView

Inventário e monitoramento da infraestrutura de TI: links de internet, firewalls, switches,
access points, servidores e telefonia.

## Estado atual

Primeira fase: **inventário**. A interface é organizada por camadas. Prontas até agora:

**Explorer** (`/explorer`, a tela inicial), montado a partir da Topologia, com sensores simulados por enquanto:

- mapa escuro (Leaflet) com um marcador por site. O mapa base vem de serviços públicos e
  gratuitos, sem chave de API (Esri e OpenStreetMap; a CARTO passou a exigir chave), tentados em
  ordem até um responder, com seletor no canto do mapa; se a rede bloquear todos, ficam os
  contornos offline de países, estados e rios (Natural Earth), servidos pelo próprio InfraView.
  Cada site aparece na posição cadastrada em Sites (latitude e longitude);
- aproximando, aparecem os dois tipos de objeto de cada planta, vindos do desenho da Topologia: o
  **CPD** (quadrado de cantos arredondados), onde fica o switch central, e os **racks** de acesso
  (círculo), um por switch restante do desenho. Os racks do CPD têm 42U; os de acesso têm 16U
  quando o switch é empilhado ou de 48 portas e 12U nos demais. Os racks mostram o que o desenho
  documenta (DIO quando há fibra e os switches); os APs ficam na sala do switch a que se ligam. A
  posição dos racks no mapa é ilustrativa, porque o desenho não tem geografia;
- no painel de cada CPD ou rack, o quadro **Rede** lista os switches e APs com o status (o mesmo da
  Topologia) e os enlaces com meio, fibras e portas, com link para o ativo na Topologia;
- ao abrir um CPD ou rack (`/explorer/sala/<id>`): relógio e dados do controlador, sensores,
  log de eventos ao vivo, medidores e gráficos de 24 h (temperatura e umidade, tensão, potência e
  consumo; no CPD também corredor frio, CO₂ e PM2.5), câmeras do CPD e a elevação dos racks.

**Layer 4 · Rede WAN**:

- inventário dos links de cada site: operadora, circuito, tecnologia, banda, papel
  (principal/secundário/backup), IP fixo, máscara, gateway, mascaramento (NAT), equipamento e
  porta SD-WAN e VLANs internas;
- topologia animada (operadoras → SD-WAN → core/LAN), painéis de tráfego, latência, alertas e
  disponibilidade, e um log de eventos.

**Layer 3 · Switches** (`/lan`), com dados fictícios por enquanto:

- switches agrupados por site (grupos recolhíveis), um quadrado por porta, no formato do painel
  do switch: ímpares em cima e pares embaixo (01/02 … 23/24); switches de 48 portas mostram dois
  blocos de 24 lado a lado; só as duas primeiras e as duas últimas portas de cada bloco levam
  etiqueta; os uplinks ficam nas colunas U1–U4;
- cores: verde conectada, amarela em alerta ou 100 Mbps, vermelha desconectada, com erro ou
  10 Mbps, cinza desabilitada;
- indicadores de saúde, filtro "somente com problemas", detalhes da porta e do switch ao clicar,
  alertas e log de eventos.

**Topologia** (`/topologia`), a camada 2 de cada planta, adaptada dos desenhos oficiais do Visio
(BR-MAT rev. 2 e BR-ACS rev. 2):

- desenho com os ativos, as salas sem ativo (passagem de cabo) e todos os enlaces: fibra SM ou MM
  com a quantidade de fibras, UTP, rádio, conectores (SFP Cisco, conversor, injetor PoE), anéis
  ópticos, conexões interrompidas e observações em vermelho do desenho (baseline pendente, STP a
  ser ativado);
- um marcador de status em cada equipamento (online, degradado, offline), por enquanto simulado;
- ao passar o mouse ou clicar, os detalhes do ativo e das portas; abaixo, a tabela com a
  documentação de todos os enlaces da planta.

**Servidores** (`/servidores`), com dados fictícios por enquanto, organizada em três colunas por
cluster de virtualização:

- CPU: capacidade total do cluster (GHz, sockets, cores, threads, relação vCPU:pCPU) e, por host,
  fabricante, modelo do processador, clock base e turbo, cores, threads, cache e uso recente;
- memória: RAM instalada e máxima possível no cluster e por host, tipo (DDR3, DDR4, DDR5),
  velocidade, módulos e o mapa de slots, destacando os slots livres;
- armazenamento: capacidade, uso, provisionamento e overcommit, divisão por tipo (VMFS, NFS,
  vSAN), baias do storage e a lista de datastores compartilhados e locais.

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
  app/seed.py           dados de exemplo (inclui coordenadas dos sites de exemplo)
  alembic/              migrações do banco
  tests/                testes da API
frontend/
  src/topology/         Topologia: camada 2 das plantas (desenho, status, documentação dos enlaces)
  src/explorer/         Explorer: mapa dos sites, salas técnicas, painel da sala e racks
  src/wan/              tela Layer 4 · Rede WAN (topologia, painéis, simulação, formulário)
  src/lan/              tela Layer 3 · Switches (grade de portas e dados fictícios)
  src/servers/          tela Servidores (CPU, memória e armazenamento do cluster)
  src/pages/            cadastro de sites
  src/components/       layout, relógio, modal
docker-compose.yml
```

## Próximos passos

1. Cadastro real de switches e portas, alimentado pelo LibreNMS.
2. Dados reais dos servidores via vCenter; demais camadas: firewall, Wi-Fi e telefonia.
3. Integração com LibreNMS e PRTG: trocar a telemetria simulada por dados reais.
4. Autenticação de usuários.
