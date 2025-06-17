#!/bin/bash

DOMAIN_NAME=housestocktrades.com
APP_PORT=3000
REPO_URL=https://github.com/yourusername/your-repo.git

sudo apt update && sudo apt upgrade -y

echo "Installing Node.js, git, and Nginx..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs git nginx ufw python3-certbot-nginx

echo "Cloning project..."
git clone $REPO_URL app
cd app
npm install

# Persistance with pm2
# sudo npm install -g pm2
# pm2 start server.mjs --node-args="--experimental-modules"
# pm2 startup
# pm2 save

echo "Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# Nginx Reverse Proxy
echo "Configuring Nginx..."
sudo tee /etc/nginx/sites-available/default > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN_NAME;

    location / {
        proxy_pass http://localhost:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

sudo nginx -t && sudo systemctl reload nginx

echo "Setting up HTTPS with Certbot..."
sudo certbot --nginx --non-interactive --agree-tos -d $DOMAIN_NAME --register-unsafely-without-email

echo "Deployment complete. App should be live at https://$DOMAIN_NAME"


#chmod +x setup_ec2.sh