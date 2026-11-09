#!/bin/bash
export PATH=$PATH:/usr/local/bin
cd "$(dirname "$0")" || exit 1
docker-compose logs -f --tail 1
