#!/usr/bin/env bash
# Controls the local InfraView server. Called by the Windows control panel
# (tools/InfraView.ps1) through `wsl -u root`, but works from any shell:
#
#   bash tools/infraview.sh status | start | stop | restart | update [branch] | check [branch] | seed | branches | logs
#
# `update` and `check` follow the given branch, or the most recently updated
# branch on GitHub when none (or "auto") is given. `check` exits 10 when an
# update is available and prints nothing, so it can be polled quietly.

set -uo pipefail

main() {
  cd "$(dirname "$(readlink -f "$0")")/.." || exit 1

  local action="${1:-status}"
  case "$action" in
    status) status ;;
    start) start ;;
    stop) stop ;;
    restart) stop && start ;;
    update) update "${2:-auto}" ;;
    check) check "${2:-auto}" ;;
    seed) ensure_docker && seed ;;
    branches) git fetch --quiet --prune origin && remote_branches ;;
    logs) ensure_docker && docker compose logs --tail 150 ;;
    *)
      echo "Ação desconhecida: $action" >&2
      return 2
      ;;
  esac
}

# The repository lives on the Windows drive, owned by the Windows user.
git() { command git -c safe.directory='*' "$@"; }

say() { echo ">> $*"; }

docker_up() { docker info >/dev/null 2>&1; }

ensure_docker() {
  docker_up && return 0
  say "Iniciando o Docker…"
  service docker start >/dev/null 2>&1
  for _ in $(seq 1 30); do
    docker_up && return 0
    sleep 1
  done
  echo "ERRO: o Docker não iniciou. Veja 'service docker status' no Ubuntu." >&2
  return 1
}

server_running() {
  docker_up && [ -n "$(docker compose ps -q --status running 2>/dev/null)" ]
}

env_value() {
  local value
  value=$(grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-)
  echo "${value:-$2}"
}

wait_for_api() {
  for _ in $(seq 1 60); do
    if docker compose exec -T backend python -c \
      "import urllib.request; urllib.request.urlopen('http://localhost:8010/api/health')" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "AVISO: a API não respondeu em 60 s. Veja os logs." >&2
  return 1
}

seed() {
  docker compose exec -T backend python -m app.seed 2>/dev/null || true
}

start() {
  ensure_docker || return 1
  say "Construindo e iniciando os containers…"
  docker compose up -d --build --remove-orphans || return 1
  say "Aguardando a API…"
  wait_for_api && seed
  say "Servidor no ar: http://localhost:$(env_value WEB_PORT 8080)"
}

stop() {
  if ! docker_up; then
    say "O Docker já está parado."
    return 0
  fi
  say "Parando os containers…"
  docker compose stop
}

remote_branches() {
  git for-each-ref --sort=-committerdate --format='%(refname:lstrip=3)' refs/remotes/origin | grep -vx HEAD
}

resolve_branch() {
  if [ "$1" = "auto" ] || [ -z "$1" ]; then
    remote_branches | head -1
  else
    echo "$1"
  fi
}

# Prints the target commit when the checkout differs from origin/<branch>.
pending_update() {
  local branch="$1" target
  target=$(git rev-parse --verify --quiet "origin/$branch") || {
    echo "ERRO: branch '$branch' não existe no GitHub." >&2
    return 2
  }
  if [ "$(git rev-parse HEAD)" != "$target" ] || [ "$(git symbolic-ref --quiet --short HEAD)" != "$branch" ]; then
    echo "$target"
  fi
}

check() {
  git fetch --quiet --prune origin || return 1
  local branch
  branch=$(resolve_branch "$1")
  local pending
  pending=$(pending_update "$branch") || return $?
  [ -n "$pending" ] && return 10
  return 0
}

update() {
  say "Buscando alterações no GitHub…"
  git fetch --prune origin || return 1
  local branch pending
  branch=$(resolve_branch "$1")
  pending=$(pending_update "$branch") || return $?
  if [ -z "$pending" ]; then
    say "Já está na versão mais recente ($branch @ $(git log -1 --format=%h))."
    return 0
  fi
  say "Atualizando para $branch…"
  git checkout --force -B "$branch" "origin/$branch" || return 1
  say "Versão: $(git log -1 --format='%h %s')"
  if server_running; then
    say "Reconstruindo o servidor com a nova versão…"
    docker compose up -d --build --remove-orphans || return 1
    wait_for_api && seed
    say "Servidor atualizado."
  else
    say "Código atualizado. Clique em Iniciar para subir o servidor."
  fi
}

status() {
  local docker="off" server="stopped" services=""
  if docker_up; then
    docker="on"
    services=$(docker compose ps --all --format '{{.Service}}:{{.State}}' 2>/dev/null | tr '\n' ' ')
    if server_running; then
      server="running"
      docker compose ps --format '{{.State}}' 2>/dev/null | grep -qv running && server="partial"
    fi
  fi
  echo "docker=$docker"
  echo "server=$server"
  echo "services=$services"
  echo "branch=$(git symbolic-ref --quiet --short HEAD || echo '(sem branch)')"
  echo "version=$(git log -1 --format='%h %s')"
  echo "url=http://localhost:$(env_value WEB_PORT 8080)"
}

# Wrapping everything in main() makes bash parse the whole file before running,
# so `update` can safely replace this script while it executes.
main "$@"
exit $?
