#!/bin/bash
set -e
HOST="${VPS_HOST:-fasem.com}"
USER="${VPS_USER:-fasem}"
REMOTE_DIR="/app/fasem-p"
echo "=== Deploying to $HOST ==="
rsync -avz --delete \
    --exclude 'backend/cemos.db' \
    --exclude 'backend/__pycache__' \
    --exclude '.git' \
    --exclude 'node_modules' \
    -e "ssh -o StrictHostKeyChecking=no" \
    ./ $USER@$HOST:$REMOTE_DIR
ssh -o StrictHostKeyChecking=no $USER@$HOST "sudo systemctl restart fasem-p"
sleep 3
echo "Deploy complete"
