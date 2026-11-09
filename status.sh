#!/bin/bash
export PATH=$PATH:/usr/local/bin
cd "$(dirname "$0")" || exit 1
docker-compose ps
docker inspect --format "health: {{.State.Health.Status}}" price-tracker
