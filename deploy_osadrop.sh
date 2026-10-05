#!/bin/bash
rm -rf /var/www/osadrop
mkdir -p /var/www/osadrop
cd /var/www/osadrop
git clone https://github.com/osayanis/osadrop.git .
npm install
npm run build
pm2 delete osadrop || true
pm2 start npm --name "osadrop" -- run start
pm2 save

cat > /etc/nginx/sites-available/osadrop << 'EOF'
server {
    listen 80;
    server_name osadrop.osalabs.fr;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/osadrop /etc/nginx/sites-enabled/osadrop
systemctl restart nginx
