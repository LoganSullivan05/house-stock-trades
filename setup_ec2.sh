#!/bin/bash

DOMAIN_NAME=housestocktrades.com
APP_PORT=3000

sudo yum update -y

echo "Installing Node.js, git, and Nginx..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc
echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> ~/.bashrc
source ~/.bash_profile

ln -s "$NVM_DIR/versions/node/$(nvm version)/bin/node" /usr/local/bin/node
ln -s "$NVM_DIR/versions/node/$(nvm version)/bin/npm" /usr/local/bin/npm

nvm install 18
nvm use 18
nvm alias default 18

npm install

sudo yum install -y nginx firewalld git python3-certbot-nginx
sudo yum install -y python-pip
pip install PyPDF2

echo "Configuring firewall..."
sudo systemctl enable firewalld --now
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload

# Nginx Reverse Proxy
echo "Configuring Nginx..."
sudo tee /etc/nginx/nginx.conf > /dev/null <<EOF
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    log_format main '\$remote_addr - \$remote_user [\$time_local] "\$request" '
                    '\$status \$body_bytes_sent "\$http_referer" '
                    '"\$http_user_agent" "\$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

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
}
EOF

sudo systemctl enable nginx --now
sudo nginx -t && sudo systemctl reload nginx

echo "Setting up HTTPS with Certbot..."
sudo certbot --nginx --non-interactive --agree-tos -d $DOMAIN_NAME --register-unsafely-without-email

echo "Deployment complete. App should be live at https://$DOMAIN_NAME"
