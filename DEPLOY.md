# Hostinger Deployment Guide

## 1. Build the Frontend

```bash
cd vin-dashboard
npm run build
```

This creates a `dist/` folder with the production React app.

## 2. Database Setup

In Hostinger hPanel → Databases → Create a new MySQL database:
- Database name: `vin_dashboard`
- Create a database user and assign it to the database

Then import this SQL via phpMyAdmin:

```sql
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin','carfax','filter','tlo') NOT NULL DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vehicles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE files (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id INT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    year INT DEFAULT NULL,
    version VARCHAR(20) DEFAULT NULL,
    current_stage ENUM('generated','carfax','filter','tlo') NOT NULL DEFAULT 'generated',
    added_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
    FOREIGN KEY (added_by) REFERENCES users(id)
);

CREATE TABLE file_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    file_id INT NOT NULL,
    user_id INT NOT NULL,
    from_stage VARCHAR(20) DEFAULT NULL,
    to_stage VARCHAR(20) NOT NULL,
    notes TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Default admin user (password: admin123)
INSERT INTO users (name, email, password, role) VALUES
('Admin', 'admin@vin.com', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin');
```

## 3. Update DB Credentials

Edit `api/config.php` and replace the placeholders:
```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'your_hostinger_username_vin_dashboard');
define('DB_USER', 'your_hostinger_username_dbuser');
define('DB_PASS', 'your_actual_password');
```

## 4. Upload Files to Hostinger

Via File Manager or FTP, upload to `public_html/vin-dashboard/`:

```
public_html/vin-dashboard/
├── index.html          ← from dist/
├── assets/             ← from dist/assets/
├── .htaccess           ← from project root
└── api/
    ├── config.php
    ├── auth.php
    ├── me.php
    ├── logout.php
    ├── files.php
    ├── vehicles.php
    ├── users.php
    └── logs.php
```

Steps:
1. Upload everything inside `dist/` → `public_html/vin-dashboard/`
2. Upload the `api/` folder → `public_html/vin-dashboard/api/`
3. Upload `.htaccess` → `public_html/vin-dashboard/.htaccess`

## 5. Verify

1. Visit `yourdomain.com/vin-dashboard/`
2. Login with: `admin@vin.com` / `admin123`
3. Test all pages: Dashboard, Files, Vehicles, Users

## Troubleshooting

- **Blank page?** Check that `.htaccess` was uploaded and `mod_rewrite` is enabled
- **API 500 errors?** Check `api/config.php` DB credentials. Hostinger prepends your username to DB names
- **Session issues?** Make sure all PHP files use `initSession()` (not `session_start()`)
- **404 on refresh?** The `.htaccess` SPA fallback handles this — make sure it's in the right directory
