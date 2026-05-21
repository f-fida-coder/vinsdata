#!/usr/bin/env bash
# VinVault CRM — one-shot VPS provisioner.
#
# Idempotent. Safe to re-run. Installs the full stack so a clean
# Ubuntu 22.04 droplet becomes a CRM-serving host with one paste:
#
#   nginx 1.18                — web server
#   PHP 8.3 + FPM             — application runtime
#   MariaDB 10.x              — database
#   certbot + dns-nginx       — Let's Encrypt SSL
#   rsync, git, ufw           — deploy + firewall
#
# Outputs:
#   /root/.crm-vps-creds      — DB password + SSH deploy key (chmod 600)
#   /var/www/crm/             — webroot (frontend dist/ + api/)
#   /var/www/crm/.env         — DB credentials for the PHP boot chain
#   /etc/nginx/sites-available/crm.vinvault.us
#
# After this finishes:
#   1. Point crm.vinvault.us DNS A record to this VPS's IP.
#   2. Once DNS resolves, run:
#        certbot --nginx -d crm.vinvault.us --non-interactive --agree-tos -m admin@vinvault.us
#   3. Add the printed SSH deploy key as a GitHub Actions secret +
#      update the deploy workflow to push here.
#   4. Import the SQL dump via:
#        mysql -u vinvault_app -p"$DB_PASSWORD" vinvault_crm < dump.sql

set -euo pipefail

DOMAIN="crm.vinvault.us"
WEBROOT="/var/www/crm"
DB_NAME="vinvault_crm"
DB_USER="vinvault_app"
CREDS_FILE="/root/.crm-vps-creds"
ADMIN_EMAIL="admin@vinvault.us"

log() { echo -e "\n\033[1;36m▶ $*\033[0m"; }

# -- 0. Pre-flight ------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo bash $0)"; exit 1
fi

# -- 1. System update ---------------------------------------------------
log "Updating apt + installing prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl wget gnupg lsb-release ca-certificates software-properties-common \
  rsync git zip unzip vim ufw

# -- 2. nginx + PHP 8.3 (Ondřej PPA) ------------------------------------
log "Adding PHP 8.3 PPA + installing nginx + PHP-FPM"
if ! grep -q "ondrej/php" /etc/apt/sources.list.d/*.list 2>/dev/null; then
  add-apt-repository -y ppa:ondrej/php
fi
apt-get update -qq
apt-get install -y -qq \
  nginx \
  php8.3 php8.3-fpm \
  php8.3-mysql php8.3-curl php8.3-mbstring php8.3-xml \
  php8.3-zip php8.3-gd php8.3-intl php8.3-bcmath

# Bump PHP upload size + timeouts a bit — TLO spreadsheets get chunky
PHPINI="/etc/php/8.3/fpm/php.ini"
sed -i 's/^upload_max_filesize = .*/upload_max_filesize = 64M/' "$PHPINI"
sed -i 's/^post_max_size = .*/post_max_size = 64M/' "$PHPINI"
sed -i 's/^max_execution_time = .*/max_execution_time = 120/' "$PHPINI"
sed -i 's/^memory_limit = .*/memory_limit = 256M/' "$PHPINI"

# -- 3. MariaDB ---------------------------------------------------------
log "Installing MariaDB"
apt-get install -y -qq mariadb-server mariadb-client

# Generate a random DB password on first run; reuse on re-run.
if [ -f "$CREDS_FILE" ] && grep -q '^DB_PASSWORD=' "$CREDS_FILE"; then
  DB_PASSWORD=$(grep '^DB_PASSWORD=' "$CREDS_FILE" | cut -d= -f2-)
else
  DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
fi

log "Creating database $DB_NAME + user $DB_USER"
mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL

# -- 4. Webroot + .env --------------------------------------------------
log "Setting up webroot at $WEBROOT"
mkdir -p "$WEBROOT/api"
chown -R www-data:www-data "$WEBROOT"

# Write .env at the webroot (api/config.php searches one level above).
cat > "$WEBROOT/.env" <<ENV
DB_HOST=127.0.0.1
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASS=$DB_PASSWORD
ENV
chmod 640 "$WEBROOT/.env"
chown root:www-data "$WEBROOT/.env"

# -- 5. nginx vhost -----------------------------------------------------
log "Writing nginx vhost for $DOMAIN"
cat > /etc/nginx/sites-available/$DOMAIN <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root $WEBROOT;
    index index.html index.php;

    client_max_body_size 64M;

    # API routes go to PHP. Strip the trailing slash + map /api/<name>
    # to /api/<name>.php on disk, matching our .htaccess behavior.
    location ^~ /api/ {
        rewrite ^/api/(.+)\$ /api/\$1.php break;
        try_files \$uri =404;
        fastcgi_split_path_info ^(.+\.php)(/.+)\$;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        include fastcgi_params;
    }

    # SPA fallback. Any other route serves index.html so the React
    # Router takes over client-side.
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Long-cache the hashed assets, no-cache the HTML shell so deploys
    # show up without a hard refresh.
    location ~* \.(?:js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$ {
        expires 1y;
        access_log off;
        add_header Cache-Control "public, immutable";
    }
    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
rm -f /etc/nginx/sites-enabled/default

# Drop a placeholder index.html so nginx serves SOMETHING until we deploy
cat > "$WEBROOT/index.html" <<HTML
<!doctype html>
<title>VinVault CRM</title>
<style>body { font-family: system-ui; padding: 40px; max-width: 720px; margin: auto; color: #444; }</style>
<h1>VinVault CRM</h1>
<p>Server is provisioned. Awaiting first deploy.</p>
HTML
chown www-data:www-data "$WEBROOT/index.html"

nginx -t
systemctl reload nginx
systemctl enable nginx php8.3-fpm mariadb

# -- 6. Firewall --------------------------------------------------------
log "Configuring UFW (SSH, HTTP, HTTPS)"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
echo "y" | ufw enable >/dev/null

# -- 7. Deploy SSH key (used by GitHub Actions) -------------------------
log "Generating deploy SSH key (GitHub Actions will use this to rsync)"
DEPLOY_KEY="/root/.ssh/crm_deploy"
if [ ! -f "$DEPLOY_KEY" ]; then
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh
  ssh-keygen -t ed25519 -f "$DEPLOY_KEY" -N "" -C "github-actions@crm.vinvault.us"
  cat "$DEPLOY_KEY.pub" >> /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
fi

# -- 8. Stash credentials so user can read them later ------------------
log "Writing credentials summary to $CREDS_FILE"
cat > "$CREDS_FILE" <<CREDS
# VinVault CRM — VPS credentials
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Keep this file safe. chmod 600.

DOMAIN=$DOMAIN
WEBROOT=$WEBROOT

DB_HOST=127.0.0.1
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

DEPLOY_PRIVATE_KEY_PATH=$DEPLOY_KEY
DEPLOY_PUBLIC_KEY=$(cat $DEPLOY_KEY.pub)

# To use the deploy key from GitHub Actions, paste the contents of
# $DEPLOY_KEY (private) as the HOSTINGER_SSH_KEY GitHub secret. The
# public key is already in /root/.ssh/authorized_keys.
CREDS
chmod 600 "$CREDS_FILE"

# -- 9. Done ------------------------------------------------------------
PUBLIC_IP=$(curl -s ifconfig.me || echo "unknown")

cat <<DONE


===================================================================
  VinVault CRM VPS provisioned — copy these values back to me
===================================================================

  Public IP:        $PUBLIC_IP
  DB password:      $DB_PASSWORD
  Webroot:          $WEBROOT
  Domain (planned): $DOMAIN

  Deploy public key (already in authorized_keys):
$(cat $DEPLOY_KEY.pub)

  Deploy PRIVATE key (paste as GitHub Actions HOSTINGER_SSH_KEY):
$(cat $DEPLOY_KEY)

===================================================================

NEXT STEPS:
  1. Point $DOMAIN DNS A record → $PUBLIC_IP
  2. Once DNS propagates (~5–60 min), run:
       certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $ADMIN_EMAIL
  3. Paste the dump file Yazen sends to /root/dump.sql, then:
       mysql -u $DB_USER -p'$DB_PASSWORD' $DB_NAME < /root/dump.sql

DONE
