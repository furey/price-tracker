#!/bin/bash
export PATH=$PATH:/usr/local/bin
cd "$(dirname "$0")" || exit 1
git pull --ff-only
mkdir -p state logs
docker-compose up -d --build
