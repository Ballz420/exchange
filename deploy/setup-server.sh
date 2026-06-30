#!/bin/bash
set -e
apt update && apt upgrade -y
apt install -y python3 python3-pip nginx docker.io docker-compose git curl
useradd -m -s /bin/bash fasem || true
mkdir -p /app/fasem-p
cd /app/fasem-p
git clone https://github.com/YOUR_USERNAME/fasem-p.git .
pip3 install -r backend/requirements.txt bcrypt
cp deploy/nginx.conf /etc/nginx/sites-available/fasem-p
ln -sf /etc/nginx/sites-available/fasem-p /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo "Setup complete. Run: certbot --nginx -d fasem.com"
