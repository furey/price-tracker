#!/bin/bash
export PATH=$PATH:/usr/local/bin
cd "$(dirname "$0")" || exit 1
docker-compose down
