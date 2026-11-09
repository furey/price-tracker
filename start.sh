#!/bin/bash
export PATH=$PATH:/usr/local/bin
cd "$(dirname "$0")" || exit 1
mkdir -p state logs
docker-compose up -d --build
docker-compose logs -f --tail 20
